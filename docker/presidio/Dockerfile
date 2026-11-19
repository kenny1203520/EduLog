# Presidio analyzer with the spaCy pipelines of every language EduLog supports.
# The API passes known people (student, classmates, teachers, school) and the
# administrator's custom rules per request as ad-hoc `patterns` recognizers;
# this image adds NER as a backstop plus Taiwan phone / national ID
# recognizers in every language.
#
# All 24 language pipelines are installed at build time (see
# configure_languages.py). PRESIDIO_LANGUAGES picks the ones Presidio loads at
# start, so changing languages needs only a restart:
#   EDULOG_PRESIDIO_LANGUAGES=zh,en,ja docker compose up -d presidio-analyzer
# then enable them in Settings → AI report assistant → De-identification.
#
# The base image is pinned by tag and digest; bump both together.
FROM mcr.microsoft.com/presidio-analyzer:2.2.362@sha256:286e3fa7f3a7426e775e8564fe1870f1ba8f999d3ab8bbb8cc46a44355d9d6e9
USER root
COPY --from=legal /LICENSE /NOTICE /usr/share/licenses/EduLog/
COPY configure_languages.py start.sh /app/conf-edulog/
RUN chmod 0755 /app/conf-edulog/start.sh \
    && python /app/conf-edulog/configure_languages.py install \
    && install -d -o 1001 -m 0700 /app/conf-edulog/runtime
# The upstream image ships Debian and Python packages with known HIGH/CRITICAL
# CVEs. Apply Debian security updates, upgrade the vulnerable runtime Python
# packages to their first fixed releases, and remove Poetry (only its
# `poetry run` wrapper was used; start.sh runs gunicorn directly) together with
# its build-only dependencies. Kept after the language install so that layer
# stays cached. Re-check with trivy when bumping the base image.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && pip uninstall -y poetry dulwich virtualenv \
    && pip install --no-cache-dir --upgrade \
        anyio==4.14.2 certifi==2026.10.18 cryptography==50.0.0 \
        filelock==4.2.1 msgpack==1.2.3 urllib3==2.8.0 \
    && pip check
# Written by start.sh at container start into a directory only user 1001 can
# write (not a shared location such as /tmp).
ENV PRESIDIO_LANGUAGES=zh,en \
    EDULOG_PRESIDIO_CONF_DIR=/app/conf-edulog/runtime \
    NLP_CONF_FILE=/app/conf-edulog/runtime/nlp.yaml \
    ANALYZER_CONF_FILE=/app/conf-edulog/runtime/analyzer.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/app/conf-edulog/runtime/recognizers.yaml
USER 1001
CMD ["/app/conf-edulog/start.sh"]
