# Presidio analyzer with a Traditional/Simplified Chinese spaCy pipeline.
# The API passes known people (student, classmates, teachers, school) per
# request as ad-hoc `patterns` recognizers; this image adds NER as a backstop
# plus Taiwan phone / national ID recognizers.
FROM mcr.microsoft.com/presidio-analyzer:latest
USER root
RUN pip install --no-cache-dir https://github.com/explosion/spacy-models/releases/download/zh_core_web_sm-3.8.0/zh_core_web_sm-3.8.0-py3-none-any.whl
COPY conf/ /app/conf-zh/
ENV NLP_CONF_FILE=/app/conf-zh/nlp_zh.yaml \
    ANALYZER_CONF_FILE=/app/conf-zh/analyzer_zh.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/app/conf-zh/recognizers_zh.yaml
USER 1001
