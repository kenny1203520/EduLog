"""Install spaCy models and write Presidio configuration for EduLog.

Two steps, so one published image serves every language selection:

  python configure_languages.py install
      At image build time: install the spaCy pipeline of every language in
      MODELS and check that each pipeline's NER labels are either mapped to a
      Presidio entity or explicitly ignored, so a new label is never silently
      passed through.

  python configure_languages.py configure zh,en
      At container start: validate the chosen languages and write nlp.yaml,
      analyzer.yaml and recognizers.yaml (JSON, which YAML loaders accept) so
      Presidio loads only those pipelines. Exits non-zero for an unknown code.

The EduLog API probes the loaded languages with
GET /supportedentities?language=<code> and only lets administrators enable
those, so every configured language must load.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

SPACY_RELEASES = "https://github.com/explosion/spacy-models/releases/download"
SPACY_ASSETS_API = "https://api.github.com/repos/explosion/spacy-models/releases/assets"
SPACY_MODEL_VERSION = "3.8.0"
# One small pipeline per language: (package, GitHub release asset id, wheel
# SHA-256). The multi-language xx_* pipelines are left out: EduLog analyzes
# each report in a concrete language. Pinning the digest makes every build
# install the same files; the asset id lets the download fall back to the
# GitHub API when the release download redirect fails.
PIPELINES = {
    "ca": ("ca_core_news_sm", 195733009, "e214211aa8da91c24ebdc453c2aa5f54fac09f44e01e65bcbdd3b0a5cb94d809"),
    "da": ("da_core_news_sm", 195733782, "8caeb4dc26f56de8abcf70399b202a0b2223d38664b1a59f1cb8db0000808bc9"),
    "de": ("de_core_news_sm", 195734115, "fec69fec52b1780f2d269d5af7582a5e28028738bd3190532459aeb473bfa3e7"),
    "el": ("el_core_news_sm", 195734823, "18df59b7f099a20d6f7cc1f964a57408a4c1663b73b5110932c1ea24f66e3027"),
    "en": ("en_core_web_sm", 195734380, "1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85"),
    "es": ("es_core_news_sm", 195734572, "e451a83d6df79b87e9eed0cb553f03e99e36a3bab18a7b79f0dcfd1fdf875e12"),
    "fi": ("fi_core_news_sm", 195735141, "5b9bd1496f500c1fac98f5e6a5d3913aa502f188c094ecea191dc6b8a81f418d"),
    "fr": ("fr_core_news_sm", 195735315, "7d6ad14cd5078e53147bfbf70fb9d433c6a3865b695fda2657140bbc59a27e29"),
    "hr": ("hr_core_news_sm", 195735433, "393ad455bba13536e6fb257bce2b5ef0253f41c1fb5249d8c16dde6cf116d196"),
    "it": ("it_core_news_sm", 195735526, "3f617bf9a8ae0418953cf1fbf014e10272684c4229e882a7fd748b637d0100bf"),
    "ja": ("ja_core_news_sm", 195735709, "65693016b7cf33ffa845af3523a9c9b8d9aabae85dfc2e46731513a5e03def04"),
    "ko": ("ko_core_news_sm", 195735905, "15486b93a22ec8ee43f787390afdb4e2086851573eb12b69dd2c4f2a95b3e0a4"),
    "lt": ("lt_core_news_sm", 195736053, "c1f709112fd01771c10fbd2fe7e01d9d65712c8bccd9171065a29f91c9dc151e"),
    "mk": ("mk_core_news_sm", 195736159, "b6cf76608af1cf785523406b22e932fdc09a4d37c352d668a67639c446e29ad7"),
    "nb": ("nb_core_news_sm", 195736257, "086f2cfcc1568b2ee49a2ab297f7910f2645ae6892f2d5d15d8b077f5d0bd773"),
    "nl": ("nl_core_news_sm", 195736432, "a76978477821f213ca76a46c686df1b1d41462905d4868bc53eac086adca8b7e"),
    "pl": ("pl_core_news_sm", 195736701, "9b536db854b0cdb9132a74f68b392b8112ab6030f971bb03282462362a940dbb"),
    "pt": ("pt_core_news_sm", 195737274, "c304fa04db3af73cd08a250feacf560506e15a2ec2469bd1b09f06847f6b455c"),
    "ro": ("ro_core_news_sm", 195737734, "3cebfba2437131efe95345adcc7ea2131e4463915652df9099c577e618460cd9"),
    "ru": ("ru_core_news_sm", 195737890, "69978d47b43e2c4f329bebdb155e8e9d3861bba1a58ba25551419dae7d7e07fc"),
    "sl": ("sl_core_news_sm", 195738012, "d6d11f38c917d59b0fe52a15da09963bdc8011d2be288f75371e734065b6911c"),
    "sv": ("sv_core_news_sm", 195738078, "be4929fb30523dca0b6672f999cdbf4d64f165419f1eed0014ca3a36599b8b4d"),
    "uk": ("uk_core_news_sm", 195738185, "d20adb50b42c0dcfdedf4994dabcb96789a64983a9ab560d0c6c38a59e8efb58"),
    "zh": ("zh_core_web_sm", 195738264, "7de3bd267176b9b2a8defb6997c1cd296da16c57b5e712f72ea44a51755421c8"),
}
MODEL_NAMES = {code: name for code, (name, _asset, _digest) in PIPELINES.items()}
MODELS = {code: f"{name}-{SPACY_MODEL_VERSION}" for code, name in MODEL_NAMES.items()}
DEFAULT_LANGUAGES = "zh,en"

# NER label schemes in use: OntoNotes (en, zh, fi, mk, nl, ja), WikiNER
# (ca, da, de, es, fr, it, pt, hr, sl, ru, uk), KLUE (ko), NorNE (nb),
# NKJP (pl), RONEC (ro), SUC (sv) and the el/lt schemes. De-identification
# prefers over-masking, so labels derived from a person (DERIV_PER, PET_NAME)
# count as PERSON.
ENTITY_MAPPING = {
    "PERSON": "PERSON", "PER": "PERSON", "PS": "PERSON", "PRS": "PERSON",
    "persName": "PERSON", "DERIV_PER": "PERSON", "PET_NAME": "PERSON",
    "GPE": "LOCATION", "LOC": "LOCATION", "FAC": "LOCATION", "LC": "LOCATION",
    "FACILITY": "LOCATION", "GPE_LOC": "LOCATION", "placeName": "LOCATION", "geogName": "LOCATION",
    "ORG": "ORGANIZATION", "OG": "ORGANIZATION", "ORGANIZATION": "ORGANIZATION",
    "GPE_ORG": "ORGANIZATION", "orgName": "ORGANIZATION",
}
# Everything else a pipeline can emit. PHONE (ja) is left to the phone
# recognizers below; NORP and MISC are not personal identifiers on their own.
LABELS_TO_IGNORE = [
    "CARDINAL", "ORDINAL", "QUANTITY", "MONEY", "PERCENT", "DATE", "TIME", "NORP",
    "WORK_OF_ART", "EVENT", "LANGUAGE", "PRODUCT", "LAW", "DT", "QT", "TI",
    "MISC", "MOVEMENT", "PHONE", "TITLE_AFFIX",
    "DRV", "EVT", "PROD",
    "date", "time",
    "DATETIME", "PERIOD", "NUMERIC_VALUE", "NAT_REL_POL",
    "EVN", "MSR", "OBJ", "TME", "WRK",
]
LOW_SCORE_ENTITY_NAMES = ["ORG", "ORGANIZATION", "OG", "GPE_ORG", "orgName"]

# A directory the image creates for the analyzer user only (not a shared,
# world-writable location such as /tmp, where another process could plant
# its own configuration first).
OUT_DIR = Path(os.environ.get("EDULOG_PRESIDIO_CONF_DIR", "/app/conf-edulog/runtime"))


def parse_languages(raw: str) -> list[str]:
    languages = []
    for code in raw.split(","):
        code = code.strip().lower()
        if not code:
            continue
        if code not in MODELS:
            sys.exit(f"Unsupported Presidio language '{code}'. Available: {', '.join(MODELS)}")
        if code not in languages:
            languages.append(code)
    if not languages:
        sys.exit(f"PRESIDIO_LANGUAGES is empty. Available: {', '.join(MODELS)}")
    return languages


def fetch(url: str, headers: dict[str, str] | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "edulog-presidio-build", **(headers or {})})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def download_wheel(code: str, target: Path, attempts: int = 4) -> Path:
    """Download one pipeline wheel and verify its pinned SHA-256.

    The GitHub release download redirect sometimes answers 504 for a single
    asset for a long time, so each attempt also tries the asset through the
    GitHub API, which serves the same file.
    """
    name, asset_id, digest = PIPELINES[code]
    wheel = f"{name}-{SPACY_MODEL_VERSION}"
    path = target / f"{wheel}-py3-none-any.whl"
    sources = [
        (f"{SPACY_RELEASES}/{wheel}/{wheel}-py3-none-any.whl", None),
        (f"{SPACY_ASSETS_API}/{asset_id}", {"Accept": "application/octet-stream"}),
    ]
    errors = []
    for attempt in range(1, attempts + 1):
        for url, headers in sources:
            try:
                data = fetch(url, headers)
            except (urllib.error.URLError, TimeoutError) as error:
                errors.append(f"{url}: {error}")
                continue
            actual = hashlib.sha256(data).hexdigest()
            if actual != digest:
                sys.exit(f"{wheel}: SHA-256 {actual} does not match the pinned {digest}")
            path.write_bytes(data)
            return path
        if attempt < attempts:
            time.sleep(10 * attempt)
    sys.exit(f"Could not download {wheel}:\n  " + "\n  ".join(errors[-4:]))


def install_models() -> None:
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory)
        wheels = [str(download_wheel(code, target)) for code in PIPELINES]
        # The pipelines' own dependencies (sudachipy, spacy-pkuseg, pymorphy3)
        # still come from PyPI.
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--retries", "5", *wheels], check=True)


def check_labels() -> None:
    """Fail the build when a pipeline emits an NER label that is neither mapped nor ignored."""
    import spacy.util

    known = set(ENTITY_MAPPING) | set(LABELS_TO_IGNORE)
    problems = []
    for code, name in MODEL_NAMES.items():
        meta = json.loads((spacy.util.get_package_path(name) / "meta.json").read_text(encoding="utf-8"))
        labels = meta.get("labels", {}).get("ner", [])
        if not labels:
            problems.append(f"{code} ({name}) has no NER labels")
        unknown = sorted(set(labels) - known)
        if unknown:
            problems.append(f"{code} ({name}) has unmapped NER labels: {', '.join(unknown)}")
    if problems:
        sys.exit("NER label check failed:\n  " + "\n  ".join(problems))
    print(f"NER labels mapped for {len(MODEL_NAMES)} languages: {', '.join(MODEL_NAMES)}")


def taiwan_recognizers(code: str) -> list[dict]:
    """Taiwan national ID and mobile numbers, in every language (they appear in mixed text)."""
    return [
        {
            "name": f"TwNationalIdRecognizer_{code}",
            "supported_language": code,
            "supported_entity": "TW_NATIONAL_ID",
            "type": "custom",
            "patterns": [{"name": "tw_id", "regex": r"(?<![A-Za-z0-9])[A-Z][12489]\d{8}(?![0-9])", "score": 0.9}],
        },
        {
            "name": f"TwMobileRecognizer_{code}",
            "supported_language": code,
            "supported_entity": "PHONE_NUMBER",
            "type": "custom",
            "patterns": [{"name": "tw_mobile", "regex": r"(?<!\d)09\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)", "score": 0.85}],
        },
    ]


def write_config(languages: list[str], out_dir: Path = OUT_DIR) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    nlp = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": code, "model_name": MODEL_NAMES[code]} for code in languages],
        "ner_model_configuration": {
            "model_to_presidio_entity_mapping": ENTITY_MAPPING,
            "low_confidence_score_multiplier": 0.4,
            "low_score_entity_names": LOW_SCORE_ENTITY_NAMES,
            "labels_to_ignore": LABELS_TO_IGNORE,
        },
    }
    analyzer = {"supported_languages": languages, "default_score_threshold": 0}
    recognizers = {
        "supported_languages": languages,
        "global_regex_flags": 26,
        "recognizers": [
            {"name": "SpacyRecognizer", "supported_languages": languages, "type": "predefined"},
            {"name": "EmailRecognizer", "supported_languages": languages, "type": "predefined"},
            {"name": "PhoneRecognizer", "supported_languages": languages, "supported_regions": ["TW"], "type": "predefined"},
            *[recognizer for code in languages for recognizer in taiwan_recognizers(code)],
        ],
    }
    for name, content in (("nlp.yaml", nlp), ("analyzer.yaml", analyzer), ("recognizers.yaml", recognizers)):
        (out_dir / name).write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "install" and len(sys.argv) == 2:
        install_models()
        check_labels()
    elif command == "check" and len(sys.argv) == 2:
        check_labels()
    elif command == "configure" and len(sys.argv) <= 3:
        languages = parse_languages(sys.argv[2] if len(sys.argv) == 3 else DEFAULT_LANGUAGES)
        write_config(languages)
        print(f"Presidio languages: {', '.join(languages)}")
    else:
        sys.exit("usage: configure_languages.py install | check | configure [languages]")


if __name__ == "__main__":
    main()
