---
name: visual-verify
description: >
  Verifies UI correctness during frontend development by running DOM assertions against a live browser
  and capturing screenshot evidence. Use this skill proactively whenever you make a UI change and need
  to confirm it rendered correctly — don't wait for the user to ask. This includes: verifying a new
  component appeared on screen, checking that a click interaction works end-to-end, confirming layout
  dimensions and overflow are correct, detecting unintended visual regressions after a style change,
  and producing a final verification report when a UI task is complete. Also invoke this skill whenever
  the visual-verify-on-trigger rule directs you here.
  Triggers on: verify UI, check the page, visual verification, DOM assertion, 验证页面, 视觉验证,
  UI验收, 截图对比, 检查渲染结果, visual checkpoint, baseline screenshot.
---

# Visual Verify

Verify UI correctness through DOM assertions plus screenshot evidence. DOM assertions decide ordinary pass/fail; for spatial problems, annotated screenshots are first-class evidence and must be inspected before the final verdict.

## Prerequisites

- Install deps if needed: `cd SKILL_DIR && npm install`

Chrome CDP is handled automatically in Step 1. No manual browser setup required.

## Artifact Directory

At task start, determine a session directory:

```
SESSION_DIR = .verify/<feature>-<MMDD-HHmm>
```

Create it before writing any artifacts. All task-specific files go under `SESSION_DIR`. Global persistent memory lives in `.verify/memory/`.

```text
.verify/
  memory/
    INDEX.md                    # always read at task start; one-line pointer per memory file
    <page>--<component>.md      # per-page/component persistent knowledge (≤80 lines each)
    _common--<component>.md     # cross-page shared knowledge
    scripts/                    # reusable check scripts shared across tasks
  <feature>-<MMDD-HHmm>/       # SESSION_DIR — all task artifacts
    task-notes.md               # private notes for this task only
    baseline.png
    checkpoint-1.json
    contract.md
```

`SESSION_DIR/contract.md` is the acceptance record. `.verify/memory/` is persistent knowledge shared across tasks.

## Workflow

### Step 1 — Ensure Chrome CDP is ready

Run the environment check script before doing anything else:

```bash
bash <workspace>/visual-verify/scripts/ensure-chrome.sh
```

- If Chrome is already running with CDP on port 9222 → exits immediately, nothing changes
- If not running → detects OS, launches Chrome with an isolated profile (`/tmp/chrome-debug`), polls until ready

If the script exits with code 1, report the error to the user and stop.

Chrome is never killed automatically. If you need to close the browser when done, do it manually.

### Step 2 — Determine session directory and open a dedicated tab

**2a. Create SESSION_DIR**

Generate a session directory name and create it immediately:

```
SESSION_DIR = <workspace>/.verify/<feature>-<MMDD-HHmm>
```

```bash
mkdir -p <SESSION_DIR>
```

All task artifacts go under this directory. Use the literal path in every subsequent command — do not rely on a shell variable persisting across separate command calls.

**2b. Open a dedicated tab**

Open a new tab and capture its ID:

```bash
node scripts/open-tab.mjs --url <target-url>
# Output: A1B2C3D4-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Record the returned Tab ID in context. **Substitute this literal value into every subsequent `--tab` argument** — do not use a shell variable, as it will not persist across separate command calls.

If the target URL requires navigating to a specific state first (e.g., click a tab, fill a form), do those interactions using the fixed Tab ID before proceeding.

If a command fails mid-session, retry with the same Tab ID rather than opening a new tab.

### Step 3 — Load Memory

1. Read `.verify/memory/INDEX.md` (create if missing).
2. Identify files relevant to the target page/component and read them.
3. If any memory content is found to be wrong or stale at any point during the task, update the memory file immediately before continuing.

At task end, extract reusable findings from `task-notes.md` and merge them into the relevant memory file. Update `INDEX.md` if a new memory file was created. Each memory file should stay under 80 lines; split and update the index if it grows beyond that.

Memory files use topic-based sections (Selectors, Timing, Known Quirks, Reusable Scripts). Merge into existing entries rather than appending.

### Step 4 — Take Baseline

Before writing UI code when possible, capture the current page state:

```bash
node scripts/screenshot.mjs --tab <TAB_ID> --output <SESSION_DIR>/baseline.png
```

If baseline is impossible or only available after setup, note why in `<SESSION_DIR>/task-notes.md`.

### Step 5 — Explore Browser State

Before checkpoint JSON exists, exploratory browser work is expected. Use the scripts below to find reliable targets, trigger dynamic states, discover timing, and understand visual risk. Always pass `--tab <TAB_ID>` explicitly in every command.

```bash
# Example: evaluate JS
node scripts/eval.mjs --tab <TAB_ID> --script "document.title"

# Example: click an element
node scripts/click.mjs --tab <TAB_ID> --selector "button.submit"

# Example: wait for element
node scripts/wait.mjs --tab <TAB_ID> --selector ".result-panel"

# Example: screenshot current state
node scripts/screenshot.mjs --tab <TAB_ID> --output <SESSION_DIR>/explore-1.png
```

After each browser command, pause and ask: did this reveal a reusable target, failed selector, timing behavior, dynamic state, visual evidence, console issue, or mistake? If yes, append it to `<SESSION_DIR>/task-notes.md` before the next browser command.

Do not log every command. Log reusable facts and mistakes.

### Step 6 — Inspect Missing DOM Targets

If notes do not already cover the target state, inspect the live DOM before writing the checkpoint. Prefer stable target strategies in this order:

1. Role / aria label
2. Visible button/link text
3. Test id or explicit stable attribute
4. Stable structural selector observed in DOM
5. `custom` script when no stable selector exists

Use `inspect-dom.mjs` to inspect visible interactive elements:

```bash
node scripts/inspect-dom.mjs --tab <TAB_ID>
```

This outputs up to 80 visible elements with tag, text, aria-label, role, disabled state, class, and bounding rect.

After inspection, update `task-notes.md` with reusable findings before writing or changing checkpoint JSON.

### Step 7 — Decide Visual Evidence

Before writing checkpoint JSON for any visible UI change, make an explicit visual evidence decision.

Ask: could a screenshot reveal layout, clipping, overlap, wrapping, truncation, or boundary issues that DOM assertions may miss?

For floating UI and layout-sensitive UI, start from the assumption that annotated evidence is useful:

- Floating UI: popover, dropdown, tooltip, menu, modal, drawer, autocomplete, floating panel.
- Layout-sensitive UI: toolbars, inline buttons, cards, tables, panels, wrapped text, truncation, scroll containers.
- Boundary-sensitive UI: viewport edges, sticky/fixed headers, overflow containers, sidebars.
- Dynamic UI: content appears/disappears, selected tab changes, recent-used sections appear, validation messages expand, loading changes to result, or text length changes can alter size/position.

When the answer is yes, create annotated screenshot evidence before writing the contract. Mark the changed target and the most relevant container, boundary, trigger, or blocker. Inspect the annotated screenshot and use it to decide what assertions are needed.

When the answer is no, write one sentence in `task-notes.md` explaining why DOM assertions are enough.

Passing DOM assertions is not enough to skip annotated evidence for spatial UI.

Use `annotate-screenshot.mjs`. The default `actual` mode applies outline and numeric labels directly to the target elements, so marks are clipped, hidden, or occluded exactly like the elements. Use this default mode for pass/fail visual evidence.

```bash
node scripts/annotate-screenshot.mjs \
  --tab <TAB_ID> \
  --output <SESSION_DIR>/spatial-cpN.png \
  --mark ".target-panel" \
  --mark ".sticky-header"
```

Use at most the important marks: usually target + blocker/boundary is enough. If the blocker is unknown, mark only the target and write in notes what should be inspected next.

Use `--mode layout-rect` only as a diagnostic follow-up after a visibility problem is suspected. It draws overlay boxes at `getBoundingClientRect()` coordinates to show the full theoretical layout box, which helps explain clipping, sticky/fixed overlap, z-index, or off-viewport positioning. Do not use layout-rect mode as the pass/fail visibility evidence.

### Step 8 — Write Contract

Write `<SESSION_DIR>/checkpoint-N.json` from notes, observed DOM, and visual evidence decisions. Keep contracts minimal and behavior-focused.

- Do not include `dim`; use clear `desc` text instead.
- Do not invent selectors from component names or expected class names.
- Prefer `selector` + `filter` for text/aria/role selection when supported.
- Use `custom` for negative checks, disabled-state checks, and complex state assertions.
- If a selector is not in notes or observed DOM, inspect again before using it.

Supported assertion types only:

```text
exists, visible, rect, overflow, clipping, content, icon, occlusion, custom
```

Supported action types only:

```text
click, fill, wait, navigate, eval
```

There is no `not_exists`, `not_disabled`, or bare timeout-only `wait`. Use `custom` for those cases. `wait` requires a `selector`.

### Step 9 — Lint Contract

Before running browser assertions, statically validate the checkpoint:

```bash
node scripts/contract-lint.mjs --assertions <SESSION_DIR>/checkpoint-N.json
```

Fix schema errors before browser execution. This avoids wasting browser runs on unsupported assertion/action types or missing required fields.

### Step 10 — Run Assertions

```bash
node scripts/dom-assert.mjs --assertions <SESSION_DIR>/checkpoint-N.json --tab <TAB_ID>
```

For scenario contracts, actions run before each step's assertions. `dom-assert.mjs` supports optional `filter` for selector targets:

```json
{ "selector": "button", "filter": { "text": "重新分析" } }
```

Supported filter keys: `text` (exact trimmed text), `includes`, `ariaLabel`, `role`.

### Step 11 — Collect Failure and Console Evidence

If `clipping`, `occlusion`, `overflow`, `rect`, zero-size, or element-covered checks fail, create annotated evidence before rewriting the checkpoint or changing product code. Use default actual mode first so the frame/number is clipped or hidden like the real element. If root-cause diagnosis needs the element's full theoretical layout box, add a second screenshot with `--mode layout-rect`. Inspect the annotated screenshot before deciding whether the failure is real or selector-related.

For new visible UI, changed interactions, or bug-fix verification, check browser console output around the interaction being verified. Console errors can indicate runtime failures even when DOM assertions pass.

CDP only streams console events after attaching, so start the check before or immediately around the interaction you care about:

```bash
node scripts/console-check.mjs \
  --tab <TAB_ID> \
  --duration 3000 \
  --fail-on error \
  --output <SESSION_DIR>/console-cpN.json
```

Use `--fail-on warning` when warnings are part of the acceptance criteria. Use `--fail-on none` when you only want to collect evidence. Record relevant console findings in `task-notes.md` and mention unresolved console errors in the final report.

### Step 12 — Convert Notes to Checkpoints

Exploratory browser checks are not final verification. Before finishing visual verification, convert stable findings from `task-notes.md` into checkpoint JSON and run `contract-lint.mjs` plus `dom-assert.mjs`.

If checkpoint automation is not possible, write a `BLOCKED` note explaining why and include the exploratory evidence that supports the conclusion.

### Step 13 — Handle Results

**All passed** — capture screenshot evidence and append a concise entry to `<SESSION_DIR>/contract.md`:

```bash
node scripts/screenshot.mjs --tab <TAB_ID> --output <SESSION_DIR>/baseline-cpN.png
```

```md
## CP-N: Retry flow — ✅ 2026-05-01
- C1: retry button is visible ✅
- C2: clicking retry shows no 400 error ✅
- Baseline: baseline-cpN.png
```

Also update `task-notes.md` with reusable targets or interaction paths confirmed by the checkpoint.

**Any failed** — do not immediately rewrite the checkpoint. First check `task-notes.md` and decide which category applies:

- Contract/schema issue: run `contract-lint.mjs` and fix the JSON.
- Selector/target issue: inspect DOM and update notes with failed/correct selectors.
- Real product issue: fix code or report the user-visible failure.
- Timing issue: record instability in notes and choose a more stable assertion point.
- Spatial issue: create annotated evidence, inspect the image, then decide whether the failure is real or selector-related.

After a selector mistake is fixed, record the anti-pattern in `task-notes.md` before re-running.

### Step 14 — Reuse Script Pool

When a check becomes repeatable, save it under `.verify/memory/scripts/` and reference it in the relevant memory file:

```md
## Reusable Scripts
- `.verify/memory/scripts/check-retry-no-error.mjs`: clicks retry and asserts no known API error text.
```

Use existing scripts before writing new custom JS. This reduces repeated DOM exploration and repeated assertion code.

### Step 15 — Final Verification

When the task is complete, run relevant checkpoints again and produce a concise final report. Include:

- Final verdict
- Passed checkpoint list
- Important screenshot paths
- Any unresolved limitations or flaky states
- Any console errors or warnings relevant to the verified UI
- Any useful notes/scripts created for future runs

After presenting the final report, tell the user:

> 验证完成。Chrome 调试浏览器仍在后台运行，可供后续任务复用。如需关闭，请手动执行下面的命令或者手动关闭浏览器界面或当前任务的tab：
> macOS/Linux：`pkill -f "remote-debugging-port=9222"`

## Common Contract Patterns

**Button visible and enabled**

```json
{
  "id": "C1",
  "type": "custom",
  "desc": "重新分析按钮可见且可用",
  "script": "const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '重新分析'); return { pass: !!btn && !btn.disabled, reason: btn ? 'disabled=' + btn.disabled : 'button not found' }"
}
```

**No error text**

```json
{
  "id": "C2",
  "type": "custom",
  "desc": "页面不出现已知错误文本",
  "script": "const text = document.body.innerText; const bad = text.includes('400') || text.includes('Can only restart'); return { pass: !bad, reason: bad ? 'error text found' : 'ok' }"
}
```

**Click by visible text**

```json
{
  "id": "CP2",
  "desc": "点击重新分析后无错误",
  "steps": [
    {
      "desc": "点击重新分析",
      "action": { "type": "click", "selector": "button", "filter": { "text": "重新分析" } },
      "assertions": [
        {
          "id": "C1",
          "type": "custom",
          "desc": "页面不出现 400 错误",
          "script": "const text = document.body.innerText; return { pass: !text.includes('400'), reason: text.includes('400') ? '400 found' : 'ok' }"
        }
      ]
    }
  ]
}
```

## Scripts

All scripts accept `--tab TAB_ID` to target a tab, and `--cdp localhost:9222` to override the CDP endpoint.

| Script | Purpose |
|---|---|
| `scripts/open-tab.mjs` | Open a new Chrome tab and print its ID |
| `scripts/inspect-dom.mjs` | Dump visible interactive elements as JSON for target discovery |
| `scripts/contract-lint.mjs` | Static validation for checkpoint JSON before browser execution |
| `scripts/console-check.mjs` | Collect console messages and runtime exceptions from a live CDP tab |
| `scripts/dom-assert.mjs` | Run assertion contract (flat array or scenario) |
| `scripts/final-verify.mjs` | End-to-end final verification |
| `scripts/screenshot.mjs` | Full-page screenshot |
| `scripts/annotate-screenshot.mjs` | Screenshot with marked elements for spatial UI problems |
| `scripts/checkpoint-pass.mjs` | Legacy helper for checkpoint screenshots and diff |
| `scripts/image-diff.mjs` | Pixel diff between screenshots |
| `scripts/click.mjs` | Click an element |
| `scripts/fill.mjs` | Fill an input |
| `scripts/wait.mjs` | Wait for element to appear |
| `scripts/navigate.mjs` | Navigate to URL |
| `scripts/eval.mjs` | Execute JS in page context |
