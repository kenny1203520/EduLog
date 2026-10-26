"""Install spaCy models and write Presidio configuration for the chosen languages.

Run at image build time:  python configure_languages.py zh,en /app/conf-edulog

Writes nlp.yaml, analyzer.yaml and recognizers.yaml (JSON, which YAML
loaders accept). The EduLog API probes the installed languages with
GET /supportedentities?language=<code> and only lets administrators enable
those, so every language listed here must load.
"""
import json
import subprocess
import sys
from pathlib import Path

SPACY_RELEASES = "https://github.com/explosion/spacy-models/releases/download"
MODELS = {
    "zh": "zh_core_web_sm-3.8.0",
    "en": "en_core_web_sm-3.8.0",
    "ja": "ja_core_news_sm-3.8.0",
    "ko": "ko_core_news_sm-3.8.0",
}

# OntoNotes labels (zh, en, ja) and KLUE labels (ko: PS, LC, OG).
ENTITY_MAPPING = {
    "PERSON": "PERSON", "PER": "PERSON", "PS": "PERSON",
    "GPE": "LOCATION", "LOC": "LOCATION", "FAC": "LOCATION", "LC": "LOCATION",
    "ORG": "ORGANIZATION", "OG": "ORGANIZATION",
}
LABELS_TO_IGNORE = [
    "CARDINAL", "ORDINAL", "QUANTITY", "MONEY", "PERCENT", "DATE", "TIME", "NORP",
    "WORK_OF_ART", "EVENT", "LANGUAGE", "PRODUCT", "LAW", "DT", "QT", "TI",
]


def parse_languages(raw: str) -> list[str]:
    languages = []
    for code in raw.split(","):
        code = code.strip().lower()
        if not code:
            continue
        if code not in MODELS:
            sys.exit(f"Unsupported language '{code}'; choose from {', '.join(MODELS)}")
        if code not in languages:
            languages.append(code)
    if not languages:
        sys.exit("PRESIDIO_LANGUAGES is empty")
    return languages


def install_models(languages: list[str]) -> None:
    wheels = [f"{SPACY_RELEASES}/{MODELS[code]}/{MODELS[code]}-py3-none-any.whl" for code in languages]
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", *wheels], check=True)


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


def write_config(languages: list[str], out_dir: Path) -> None:
    out_dir = out_dir.resolve()
    expected_dir = Path("/app/conf-edulog").resolve()
    if out_dir != expected_dir:
        sys.exit("Configuration output must be /app/conf-edulog")
    out_dir.mkdir(parents=True, exist_ok=True)
    nlp = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": code, "model_name": MODELS[code].rsplit("-", 1)[0]} for code in languages],
        "ner_model_configuration": {
            "model_to_presidio_entity_mapping": ENTITY_MAPPING,
            "low_confidence_score_multiplier": 0.4,
            "low_score_entity_names": ["ORG", "ORGANIZATION", "OG"],
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
    if len(sys.argv) != 3:
        sys.exit("usage: configure_languages.py <languages> <out_dir>")
    languages = parse_languages(sys.argv[1])
    out_dir = Path(sys.argv[2]).resolve()
    if out_dir != Path("/app/conf-edulog").resolve():
        sys.exit("Configuration output must be /app/conf-edulog")
    install_models(languages)
    write_config(languages, out_dir)
    print(f"Presidio languages: {', '.join(languages)}")


if __name__ == "__main__":
    main()
