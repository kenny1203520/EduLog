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
COPY configure_languages.py start.sh /app/conf-edulog/
RUN chmod 0755 /app/conf-edulog/start.sh \
    && python /app/conf-edulog/configure_languages.py install
# Written by start.sh at container start; /tmp is writable by user 1001.
ENV PRESIDIO_LANGUAGES=zh,en \
    EDULOG_PRESIDIO_CONF_DIR=/tmp/conf-edulog \
    NLP_CONF_FILE=/tmp/conf-edulog/nlp.yaml \
    ANALYZER_CONF_FILE=/tmp/conf-edulog/analyzer.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/tmp/conf-edulog/recognizers.yaml
USER 1001
CMD ["/app/conf-edulog/start.sh"]
