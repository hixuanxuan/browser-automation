---
name: chrome-cdp
description: >
  Control Chrome browser tabs directly via Chrome DevTools Protocol (CDP). Use this skill for direct browser-control and debugging tasks: opening tabs, navigating pages, injecting scripts, executing JavaScript, inspecting browser tabs, extracting DOM, or getting page HTML/text. Do not use it for end-to-end UI correctness verification, visual QA, or screenshot evidence reports; use visual-verify for those workflows instead.
  Triggers on: "Chrome DevTools Protocol", "CDP", "Chrome CDP control", "inject script", "execute JavaScript", "extract DOM", "get page HTML/text", CDP调试, 浏览器CDP控制, 注入脚本, 执行脚本, 提取DOM, 获取页面HTML.
---

# Chrome CDP

Control Chrome browser tabs via Chrome DevTools Protocol.

## Prerequisites

Chrome must be running with remote debugging enabled. If scripts fail to connect, see
`references/chrome-debug.md` for setup instructions. The scripts print the startup command on error.

Install dependencies once:

```bash
cd .comate/skills/chrome-cdp && npm install
```

## Tab Resolution

All scripts support these optional arguments for targeting a specific tab:

| Argument | Description |
|----------|-------------|
| `--tab <id>` | Explicit tab ID (from `open-tab.mjs` output or `curl http://localhost:9222/json`) |
| `--match <pattern>` | Auto-select first tab whose URL contains this string |
| `--cdp <host:port>` | CDP endpoint, default `localhost:9222` |

When neither `--tab` nor `--match` is given, the script **auto-selects the first available page tab**
and prints which tab it chose.

## Scripts

### `open-tab.mjs` — open a new tab

```bash
node open-tab.mjs --url <url> [--cdp localhost:9222]
# Output: Tab ID: <id>
```

### `navigate.mjs` — navigate to URL

```bash
node navigate.mjs --url <url> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `click.mjs` — click an element

```bash
node click.mjs --selector <css> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `fill.mjs` — fill an input

Sets `.value` and dispatches `input`/`change` events (works with React, Vue, etc.).

```bash
node fill.mjs --selector <css> --value <text> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `get-text.mjs` — get element text

```bash
node get-text.mjs --selector <css> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `get-html.mjs` — get element outer HTML

```bash
node get-html.mjs --selector <css> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `screenshot.mjs` — take a screenshot

```bash
node screenshot.mjs --output <path.png> \
  [--selector <css>] \
  [--no-isolate] \
  [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

- No `--selector`: full-page screenshot
- `--selector`: clip to element, hiding surrounding content (isolate mode)
- `--selector --no-isolate`: clip only, preserve overlays/context

### `eval.mjs` — evaluate JavaScript

Supports `awaitPromise` — you can return a Promise and it will be awaited.

```bash
node eval.mjs --script <expression> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `inject.mjs` — inject script from URL

Appends a `<script src="...">` tag and waits for it to load.

```bash
node inject.mjs --url <script-url> [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
```

### `wait.mjs` — wait for a selector

Polls every 200ms until the element appears or timeout is reached.

```bash
node wait.mjs --selector <css> [--timeout <ms>] [--tab <id>] [--match <pattern>] [--cdp localhost:9222]
# Default timeout: 10000ms
```

## Common Workflows

**Open a page and screenshot:**

```bash
TABID=$(node open-tab.mjs --url https://example.com | grep 'Tab ID' | awk '{print $3}')
node wait.mjs   --tab $TABID --selector body
node screenshot.mjs --tab $TABID --output page.png
```

**Fill and submit a form:**

```bash
node navigate.mjs --url https://example.com/login
node fill.mjs  --selector "#email"    --value "alice@example.com"
node fill.mjs  --selector "#password" --value "secret"
node click.mjs --selector '[type=submit]'
node wait.mjs  --selector ".dashboard"
```

**Inject a helper script and read its output:**

```bash
node inject.mjs --url http://localhost:3000/extract.js
node eval.mjs   --script "JSON.stringify(window.extractResult)"
```

**Target a specific tab by URL pattern:**

```bash
node screenshot.mjs --match "my-app.local" --output app.png
```
