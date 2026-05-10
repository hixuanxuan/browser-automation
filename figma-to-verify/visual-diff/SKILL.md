---
name: visual-diff
description: >
  Figma visual inspection for design-to-implementation visual QA. Use this skill only when the task provides a Figma URL or exported Figma HTML and a dev page to compare against, using Chrome CDP and Visual Element Tree (VET) overlays to inspect layout, spacing, style, and annotated evidence. If there is no Figma source, use visual-verify instead.
  Triggers on:
  Figma视觉走查, Figma还原度, 设计稿对比, 走查, Figma URL + page comparison, exported Figma HTML + page comparison, visual diff against Figma, compare dev page to Figma, 页面和设计稿diff, 还原度检查, 标注视觉差异.
---

# Visual Diff Skill

Compare a **standard page** (reference/target) and a **dev page** (implementation under review)
through screenshots and a Visual Element Tree overlay, then surface spacing/sizing discrepancies
as structured prompts for a downstream investigation agent.

---

## Prerequisites

- `ws` and `sharp` npm packages installed: `cd .comate/skills/visual-diff && npm install`
- Skill scripts are in `<workspace>/.comate/skills/visual-diff/scripts/`

Chrome CDP is handled automatically in Step 1. No manual browser setup required.

This skill orchestrates three supporting skills: `chrome-cdp` for browser control, `element-screenshot`
for element-level screenshots, and `vet-generator` for VET overlay production. No local scripts are
invoked directly — all browser and screenshot operations are delegated to those skills.

---

## Step 1 — Ensure Chrome CDP is ready

Run the environment check script before doing anything else:

```bash
bash <workspace>/.comate/skills/visual-diff/scripts/ensure-chrome.sh
```

The script handles everything automatically:
- If Chrome is already running with CDP on port 9222 → exits immediately, nothing changes
- If Chrome is not running → detects OS, launches Chrome with an isolated profile (`/tmp/chrome-debug`), polls until ready

If the script exits with code 1, report the error to the user and stop.

**Lifecycle policy**: Chrome is never killed automatically by this skill. It is shared infrastructure
that may be used by concurrent sessions. Cleanup is handled at the user's request in the final step.

---

## Step 2 — Generate a task name

Generate a short task name that will be used as the output folder name throughout this session:

- Lowercase, hyphen-separated
- Descriptive of the comparison context (e.g., `game-list-layout`, `homepage-nav`, `search-bar`)
- Suffixed with a timestamp: `MMDD-HHmm` (e.g., `game-list-layout-0425-1530`)

Keep this name in context for the entire session. All output goes to `.vet/<task-name>/` under the
workspace root. Create that directory immediately.

---

## Step 3 — Resolve the standard page URL

The standard page can be provided in two ways:

**A. HTTP(S) URL** — use it directly.

Check if `<workspace>/viewport.json` already exists (written by the agent in a previous session after asking the user). If it does, read `width` and `mobile` directly from it as `VIEWPORT_WIDTH` and `IS_MOBILE`. Skip the question below.

If `viewport.json` is absent, you **must** ask the user for both of the following. **Do not proceed until you have answers to both questions.** If the user refuses or cannot answer, stop and report that the task cannot continue without this information.

> 1. "这个页面的目标屏幕宽度是多少？（例：移动端 390px，桌面端 1440px）"
> 2. "是移动端页面还是桌面端页面？"

Write `<workspace>/viewport.json` with the answers:

```json
{ "width": <VIEWPORT_WIDTH>, "mobile": <IS_MOBILE> }
```

Record `VIEWPORT_WIDTH`, `IS_MOBILE`. Proceed to Step 4.

**B. Figma URL** (starts with `https://www.figma.com/`) — export to HTML first:

1. Delegate to a subagent using the `figma-to-html` skill. Pass:
   - The Figma URL
   - Output directory: `<workspace>` (project root — HTML goes to `<workspace>/<node-name>/`)
   - Any Figma token the user provided; otherwise let `figma-to-html` resolve it from env / `.env` file

   Wait for the subagent to return the exported HTML directory path (e.g., `<workspace>/<node-name>/`).

2. Resolve `VIEWPORT_WIDTH` and `IS_MOBILE` using the **same rules as path A**:
   - Check if `<workspace>/viewport.json` exists (from a previous agent session) → use it directly.
   - Otherwise ask the user the two questions above. **If the user cannot answer either, stop.** Write `<workspace>/viewport.json` with the confirmed values.

3. Start a local static server for the exported directory. **Run this command with `run_in_background: true`** so the serve process does not block the agent from continuing:
   ```bash
   npx --yes serve "<workspace>/<node-name>" --listen 8989 --no-clipboard
   ```
   `serve` defaults to port 8989, but if that port is already in use it will automatically pick an available one.
   After the background task starts, read its output file and look for a line like:
   ```
   INFO  Accepting connections at http://localhost:59136
   ```
   Extract the actual port from that URL — **use this dynamic port for all subsequent steps**, not the requested 8989.
   Record the chosen port and the background task ID returned by the tool (used to stop it later).

4. **Only after the actual port has been extracted from the serve output (step 3 above)**, verify the server is reachable:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/
   ```
   Do **not** proceed with this step until `<port>` is confirmed from the `INFO  Accepting connections at ...` line — never assume 8989.
   Retry up to 3 times (with a 1-second delay) if not yet responding.

5. Set `std-url` = `http://localhost:<port>` and proceed to Step 4.

> The static server runs as a background task for the duration of this session.
> When the session ends (after the final output), stop it with the `stop_task` tool using the recorded task ID.

Both the standard page and the dev page **must** be HTTP(S) URLs. `file://` paths are not acceptable
because they prevent Chrome CDP from loading cross-origin assets correctly.

---

## Step 4 — Open dedicated tabs, configure viewport, and fix their IDs for the entire session

Each task run must use its **own pair of tabs** — one for the standard page and one for the dev
page. Do not reuse tabs left over from a previous run, because the page state (scroll position,
injected overlays, etc.) may be polluted.

Use `chrome-cdp` to open both tabs. Record the returned tab IDs immediately — label them clearly
(e.g. `STD_TAB` and `DEV_TAB`) and **use these same IDs for every subsequent operation in this
session**: screenshots, VET injection, element queries, everything.

**Immediately after opening the tabs**, configure each tab so that it matches the environment a
real user would experience. The goal is full fidelity: width must be exact, mobile state must be
correct, and the page should feel no different from a real browser session on the target device.

Apply the following rules:

**WIDTH** — always set on both tabs, must be exact:

```bash
node <chrome-cdp>/scripts/set-viewport.mjs --tab <TAB> --width <VIEWPORT_WIDTH> --height 900
```

Use `--height 900` as the default. The height only controls the initial visible area; it has no
effect on layout width or scroll behaviour, so a fixed value is acceptable unless the page has
explicit viewport-height-dependent behaviour (e.g. `100vh` hero sections). If the user mentions
such a layout, ask for the correct height and use that value instead.

**MOBILE** — only applied to DEV_TAB; STD_TAB is Figma static HTML and does not need a UA:

- `IS_MOBILE=true` → add `--mobile` flag. This sets `deviceScaleFactor=2`, `mobile=true`, and
  injects an iPhone UA so the server and any JS UA-detection code sees a mobile browser.
- `IS_MOBILE=false` → omit `--mobile`. Desktop UA, `deviceScaleFactor=1`.

```bash
# STD_TAB — width alignment only, no UA override
node <chrome-cdp>/scripts/set-viewport.mjs \
     --tab <STD_TAB> --width <VIEWPORT_WIDTH> --height 900

# DEV_TAB — width + mobile state
node <chrome-cdp>/scripts/set-viewport.mjs \
     --tab <DEV_TAB> --width <VIEWPORT_WIDTH> --height 900 [--mobile]
```

This configuration is applied **once** here. All downstream subagents use the tabs as-is and
have no knowledge of viewport details.

Then navigate both tabs to their respective URLs. The pages will render at the configured viewport
from the first load.

Never re-query the tab list mid-session to re-derive IDs. If a command fails, retry with the
same IDs rather than opening new tabs.

---

## Step 5 — Produce VET images via vet-generator

Delegate the entire screenshot and VET overlay production to a subagent using the `vet-generator`
skill. Pass the following context verbatim — substitute actual values for each placeholder:

---
**Subagent task prompt template:**

Use the `vet-generator` skill to produce original screenshots, VET overlays, and a pixel diff
for two pages.

**Inputs:**
- Standard page tab ID: `<STD_TAB>` (tab is already open — do not open a new one)
- Dev page tab ID: `<DEV_TAB>` (tab is already open — do not open a new one)
- Standard page URL: `<std-url>`
- Dev page URL: `<dev-url>`
- Selector (if element-level comparison): `<selector or "none">`
- Output directory: `<workspace>/.vet/<task-name>/`

**Return (in your final message):**
1. Absolute paths to all 6 output images: the 2 original screenshots, 2 VET overlay screenshots,
   and 2 diff images (side-by-side and pixel diff)
2. Absolute path to the VET info JSON file containing the colour-to-semantic-role mapping
3. Any structural observations (elements present on one page but absent on the other, notable
   size or count differences). If nothing stands out, say so explicitly.

---

Wait for the subagent to finish before proceeding to Step 6.

---

## Step 6 — Identify issues via vet-investigation

Delegate image analysis to a subagent using the `vet-investigation` skill:

---
**Subagent task prompt template:**

Use the `vet-investigation` skill to identify visual discrepancies.

**Inputs:**
- Standard page URL: `<std-url>`
- Dev page URL: `<dev-url>`
- Images and VET info JSON (paths as returned by the vet-generator subagent)

**Return:** The full numbered issue list with descriptions and relevant VET colours.

---

Wait for the subagent to return the issue list before proceeding.

---

## Step 7 — Clarify each issue via visual-issue-clarification

For each issue returned by vet-investigation, immediately spawn one subagent using the
`visual-issue-clarification` skill. Spawn all subagents in **parallel**.

---
**Subagent task prompt template (repeat for each issue n):**

Use the `visual-issue-clarification` skill to measure and annotate this issue.

**Inputs:**
- Issue number: `<n>`
- Issue description: `<description from vet-investigation>`
- Standard page tab ID: `<STD_TAB>`
- Dev page tab ID: `<DEV_TAB>`
- Standard page URL: `<std-url>`
- Dev page URL: `<dev-url>`
- Output directory: `<workspace>/.vet/<task-name>/`
- CDP endpoint: `localhost:9222`
- Reference image paths (original + VET screenshots, as returned by vet-generator)

---

Wait for all clarification subagents to complete.

Partition the results by verdict:
- **Real issues** (`REAL`) — proceed to the Output section below
- **False positives** (`FALSE_POSITIVE`) — silently discard; do not mention them in the output

---

## Output to the user

**Language**: Write the entire output in the same language the user used in their original query. If the user wrote in Chinese, respond in Chinese. If in English, respond in English.

Collect all clarification reports where the verdict is `REAL` and present a structured list — one
entry per real issue. False positives are not reported and not counted.

If **all** issues were false positives, output a single sentence stating that no genuine visual
differences were found and stop.

Otherwise, present one entry per real issue:

1. **Issue summary** — one sentence describing the visual problem
2. **Element locators** — how to find the element on each page
3. **Measured difference** — the property, standard value, dev value, and delta
4. **Evidence** — the numerical calculation from the clarification subagent
5. **Annotated screenshots** — embed all images inline using markdown image syntax. An issue may
   have multiple pairs of sub-images (e.g., `issue-<n>a`, `issue-<n>b`). Display every pair the
   clarification subagent produced. Never omit or skip any image for any issue.
   ```
   ![issue-<n>-standard](absolute/path/to/issue-<n>-standard.png)
   ![issue-<n>-dev](absolute/path/to/issue-<n>-dev.png)
   ```
   If the subagent produced sub-pairs, list them all in order (a, b, c…).

Finish with a one-paragraph overall summary of the diff.

---

## Cleanup (after output)

After presenting all results, ask the user what to do with the browser state opened during this session:

> 本次任务已完成。请问需要如何处理本次打开的标签页？
> - **关闭本次任务的标签页**（关闭设计页和开发页 Tab，保留 Chrome）
> - **关闭整个浏览器**（关闭 Chrome 进程）
> - **不做任何处理**（保留所有 Tab 和浏览器）

Execute based on the user's choice:

- **Close tabs only**: close the two tabs opened in Step 4:
  ```bash
  curl -X DELETE http://localhost:9222/json/close/<STD_TAB>
  curl -X DELETE http://localhost:9222/json/close/<DEV_TAB>
  ```
  Also stop the Figma static server if one was started: use the `stop_task` tool with the background task ID recorded in Step 3.

- **Close browser**: stop the Figma static server (stop_task) and kill the Chrome process:
  ```bash
  pkill -f "remote-debugging-port=9222"
  ```

- **Do nothing**: stop the Figma static server only (stop_task), leave Chrome and all tabs untouched.
