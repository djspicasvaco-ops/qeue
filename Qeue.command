#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/qeue.html"

# Find Chrome
CHROME=""
for P in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
do
  if [ -f "$P" ]; then CHROME="$P"; break; fi
done

if [ -z "$CHROME" ]; then
  osascript -e 'display alert "Chrome not found" message "Please install Google Chrome from https://www.google.com/chrome"'
  exit 1
fi

"$CHROME" --app="file://$APP" --window-size=1280,820 --no-first-run --disable-default-apps &
