# Presidio analyzer with spaCy pipelines for the languages EduLog analyzes.
# The API passes known people (student, classmates, teachers, school) and the
# administrator's custom rules per request as ad-hoc `patterns` recognizers;
# this image adds NER as a backstop plus Taiwan phone / national ID
# recognizers in every language.
#
# PRESIDIO_LANGUAGES picks the installed languages (zh, en, ja, ko). Rebuild to
# add one, e.g.:
#   EDULOG_PRESIDIO_LANGUAGES=zh,en,ja docker compose build presidio-analyzer
# then enable it in Settings → AI report assistant → De-identification.
FROM mcr.microsoft.com/presidio-analyzer:latest
ARG PRESIDIO_LANGUAGES=zh,en
USER root
COPY configure_languages.py /app/conf-edulog/configure_languages.py
RUN python /app/conf-edulog/configure_languages.py "$PRESIDIO_LANGUAGES" /app/conf-edulog
ENV NLP_CONF_FILE=/app/conf-edulog/nlp.yaml \
    ANALYZER_CONF_FILE=/app/conf-edulog/analyzer.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/app/conf-edulog/recognizers.yaml
USER 1001
