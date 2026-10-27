#!/bin/sh
# usage: convert.sh <bundle dir> <output pdf> [failOnResourceLoadingFailed]
dir="$1"
out="$2"
strict="${3:-true}"
curl -sS -u ticketing:spike-secret -o "$out" \
  -w "http=%{http_code} seconds=%{time_total} bytes=%{size_download}\n" \
  -F "files=@$dir/index.html" \
  -F "files=@$dir/header.html" \
  -F "files=@$dir/footer.html" \
  -F "files=@$dir/print.js" \
  -F "files=@$dir/print.css" \
  -F "files=@$dir/inter.woff2" \
  -F "files=@$dir/canvas-TKT-D-7.svg" \
  -F "preferCssPageSize=true" \
  -F "printBackground=true" \
  -F "emulatedMediaType=print" \
  -F "generateDocumentOutline=true" \
  -F "waitForExpression=window.__printReady === true" \
  -F "failOnResourceLoadingFailed=$strict" \
  -F "failOnConsoleExceptions=true" \
  http://pdf:3000/forms/chromium/convert/html
