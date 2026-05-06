---
name: visual-diff
description: >
  Visual regression comparison between a standard (reference) page and a dev (implementation) page
  using Chrome CDP and a Visual Element Tree (VET) overlay. Use this skill whenever the user wants
  to visually compare two web pages, find layout or spacing differences, generate VET overlays,
  identify UI bugs, or produce investigation prompts for a downstream agent to diagnose precise
  CSS discrepancies. Triggers on: visual diff, page comparison, VET overlay, screenshot diff,
  UI regression, layout bug, 视觉对比, 页面diff, 开发页和标准页对比, 截图diff, 样式差异排查.
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

**A. HTTP(S) URL** — use it directly. Proceed to Step 4.

**B. Figma URL** (starts with `https://www.figma.com/`) — export to HTML first:

1. Delegate to a subagent using the `figma-to-html` skill. Pass:
   - The Figma URL
   - Output directory: `<workspace>/.vet/<task-name>/figma-export/`
   - Any Figma token the user provided; otherwise let `figma-to-html` resolve it from env / `.env` file

   Wait for the subagent to return the exported HTML directory path (e.g., `.vet/<task-name>/figma-export/<node-name>/`).

2. Start a local static server for the exported directory:
   ```bash
   npx --yes serve "<exported-dir>" --listen 8989 --no-clipboard &
   FIGMA_SERVER_PID=$!
   ```
   If port 8989 is already in use, try 8990, 8991, and so on until one succeeds.
   Record the chosen port.

3. Verify the server is reachable:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/
   ```
   Retry up to 3 times (with a 1-second delay) if not yet responding.

4. Set `std-url` = `http://localhost:<port>` and proceed to Step 4.

> The static server process runs in the background for the duration of this session.
> When the session ends (after the final output), stop it: `kill $FIGMA_SERVER_PID 2>/dev/null`

Both the standard page and the dev page **must** be HTTP(S) URLs. `file://` paths are not acceptable
because they prevent Chrome CDP from loading cross-origin assets correctly.

---

## Step 4 — Open dedicated tabs and fix their IDs for the entire session

Each task run must use its **own pair of tabs** — one for the standard page and one for the dev
page. Do not reuse tabs left over from a previous run, because the page state (scroll position,
injected overlays, etc.) may be polluted.

Use `chrome-cdp` to open both tabs at the start of the task. Record the returned tab IDs
immediately — label them clearly (e.g. `STD_TAB` and `DEV_TAB`) and **use these same IDs for
every subsequent operation in this session**: screenshots, VET injection, element queries, everything.

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

---

## Output to the user

**Language**: Write the entire output in the same language the user used in their original query. If the user wrote in Chinese, respond in Chinese. If in English, respond in English.

Collect all clarification reports and present a structured list — one entry per issue:

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
  Also stop the Figma static server if one was started: `kill $FIGMA_SERVER_PID 2>/dev/null`

- **Close browser**: kill the Chrome process and stop the Figma static server:
  ```bash
  kill $FIGMA_SERVER_PID 2>/dev/null
  pkill -f "remote-debugging-port=9222"
  ```

- **Do nothing**: stop the Figma static server only (`kill $FIGMA_SERVER_PID 2>/dev/null`), leave Chrome and all tabs untouched.
