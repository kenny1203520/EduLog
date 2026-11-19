#!/bin/sh
# Write the Presidio configuration for the languages chosen at start, then run
# the analyzer. An unknown language code stops the container (non-zero exit).
set -eu

python /app/conf-edulog/configure_languages.py configure "${PRESIDIO_LANGUAGES:-zh,en}"
# Same command as the upstream entrypoint.sh without the `poetry run` wrapper
# (Poetry uses no virtualenv in this image and is removed at build time).
cd /app
exec gunicorn -w "${WORKERS:-1}" -b "0.0.0.0:${PORT:-3000}" "app:create_app()"
