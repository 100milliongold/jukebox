#!/bin/sh
# Drop the external Plausible script from index.html before nginx starts.
# plausible.trieve.ai does not answer TCP connections, and because the tag is
# `defer` and precedes the app's module script, the app waits for it to time out
# (about 75 seconds) before rendering anything.
set -eu
sed -i 's#src="https://plausible.trieve.ai/js/script.js"##' /usr/share/nginx/html/index.html
