# Starting Chrome with Remote Debugging

Chrome must be launched with remote debugging enabled before any `chrome-cdp` scripts can connect to it.

## macOS

```bash
# Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0

# Chrome Canary
/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary \
  --remote-debugging-port=9222
```

Or create a convenience alias:

```bash
alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222'
```

## Linux

```bash
google-chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0
# or
chromium-browser --remote-debugging-port=9222
```

## Windows

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

## Verify the connection

Once Chrome is running, confirm the debugging port is reachable:

```bash
curl http://localhost:9222/json
```

You should see a JSON array of open tabs. Each tab has an `"id"` field — this is the tab ID used by `--tab`.

## Notes

- If Chrome is already running **without** `--remote-debugging-port`, you must quit it first and relaunch with the flag. There is no way to enable debugging on a running Chrome instance.
- The `--remote-debugging-address=0.0.0.0` flag allows connections from outside localhost (e.g. Docker containers). Omit it if you only need local access.
- To use a different port, pass `--cdp localhost:<port>` to any chrome-cdp script.
- On macOS, the default Chrome user profile is used. To isolate the session, add `--user-data-dir=/tmp/chrome-debug`.
