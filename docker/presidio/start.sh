#!/bin/sh
# Write the Presidio configuration for the languages chosen at start, then run
# the analyzer. An unknown language code stops the container (non-zero exit).
set -eu

python /app/conf-edulog/configure_languages.py configure "${PRESIDIO_LANGUAGES:-zh,en}"
exec ./entrypoint.sh "$@"
