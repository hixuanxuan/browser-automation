#!/usr/bin/env bash
# ensure-chrome.sh
# Ensure a Chrome instance with remote debugging on port 9222 is running.
# If already running, exits immediately. If not, auto-starts Chrome with an
# isolated profile and waits for CDP to become ready.
# Chrome is NEVER killed by this script — it is shared infrastructure.
#
# Exit codes:
#   0  CDP is ready
#   1  CDP did not become ready within the timeout

CDP_HOST="${CDP_HOST:-localhost:9222}"
MAX_ATTEMPTS=10

check_cdp() {
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://${CDP_HOST}/json" 2>/dev/null)
  [ "$STATUS" = "200" ]
}

# ── Already running? ──────────────────────────────────────────────────────────
if check_cdp; then
  echo "[ensure-chrome] Chrome CDP already reachable at ${CDP_HOST}. Nothing to do."
  exit 0
fi

# ── Auto-start ────────────────────────────────────────────────────────────────
OS="$(uname -s)"

case "$OS" in
  Darwin)
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    USER_DATA_DIR="$HOME/.chrome-debug"
    ;;
  Linux)
    # Try common binary names in order
    for bin in google-chrome google-chrome-stable chromium-browser chromium; do
      if command -v "$bin" &>/dev/null; then
        CHROME_BIN="$bin"
        break
      fi
    done
    USER_DATA_DIR="$HOME/.chrome-debug"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    CHROME_BIN="C:/Program Files/Google/Chrome/Application/chrome.exe"
    USER_DATA_DIR="C:/Temp/chrome-debug"
    ;;
  *)
    echo "[ensure-chrome] ERROR: Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

if [ -z "$CHROME_BIN" ] || [ ! -f "$CHROME_BIN" ] && ! command -v "$CHROME_BIN" &>/dev/null; then
  echo "[ensure-chrome] ERROR: Chrome binary not found." >&2
  echo "  Expected: $CHROME_BIN" >&2
  echo "  Install Chrome or set CDP_HOST to point to an existing instance." >&2
  exit 1
fi

echo "[ensure-chrome] Starting Chrome with remote debugging on port 9222..."
echo "[ensure-chrome]   Binary   : $CHROME_BIN"
echo "[ensure-chrome]   Profile  : $USER_DATA_DIR"

"$CHROME_BIN" \
  --remote-debugging-port=9222 \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-default-apps \
  --disable-extensions \
  &>/dev/null &

# ── Wait for CDP ──────────────────────────────────────────────────────────────
echo "[ensure-chrome] Waiting for CDP to become ready (max ${MAX_ATTEMPTS}s)..."
for i in $(seq 1 $MAX_ATTEMPTS); do
  sleep 1
  if check_cdp; then
    echo "[ensure-chrome] CDP ready at ${CDP_HOST} (after ${i}s)."
    exit 0
  fi
done

echo "[ensure-chrome] ERROR: CDP did not become ready after ${MAX_ATTEMPTS}s." >&2
exit 1
