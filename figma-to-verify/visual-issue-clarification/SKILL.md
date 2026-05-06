---
name: visual-issue-clarification
description: >
  Measure and annotate a single visual issue identified from VET overlay comparison.
  Given one issue description, live browser tabs, and reference screenshots, this skill locates
  the relevant elements, queries their exact computed styles via CDP, and produces two annotated
  screenshots (red for the dev page problem, green for the standard page expectation).
  Use this skill when you have one specific visual discrepancy to prove with numbers and screenshots.
  Triggers on: measure this issue, clarify visual diff, annotate layout bug, prove CSS difference,
  quantify spacing discrepancy, produce annotated screenshot for issue.
---

# Visual Issue Clarification

Take one identified visual issue and prove it with exact computed style measurements and annotated
screenshots.

## Inputs required

- **Issue number** `n` — used in all output filenames
- **Issue description** — plain-language description of the anomaly (from `vet-investigation`)
- Standard page tab ID (`STD_TAB`) and dev page tab ID (`DEV_TAB`) — must already be open
- Standard page URL and dev page URL
- Output directory
- CDP endpoint (default: `localhost:9222`)
- Reference image paths (for visual context):
  - Original screenshots (standard + dev)
  - VET overlay screenshots (standard + dev)

## Prerequisites

Install dependencies once (only needed for `annotate.mjs`):

```bash
cd <SKILL_DIR> && npm install
```

The `chrome-cdp` skill must also be available — its `eval.mjs` script is used for all DOM
measurement steps. Its scripts live at `.comate/skills/chrome-cdp/scripts/`.

## Process

### 1 — Measure computed styles

Use the `chrome-cdp` to run JavaScript in the browser tab and read back
computed style values. This is the correct way to use the chrome-cdp skill for this workflow.

Computed styles are the only source of truth — do not read class names, inline style attributes, or stylesheets as evidence. Every number reported must come directly from a computed style value you measured via CDP.

Locate the relevant elements on both pages by querying the DOM. Use the issue description and
the reference images to guide which elements and properties to measure.

### 2 — Produce annotated screenshots

Each issue produces **one or more pairs** of annotated screenshots.

#### The cardinal rule: one image = one visual claim

Every sub-image must make **exactly one claim** that can be summarised in a single sentence
(e.g. "the row container is 278px wide" or "column 2 is 68px instead of 48px").
Annotate **only the one element** that directly proves that claim. Nothing else.

If an issue has multiple distinct claims, produce multiple sub-pairs — **one pair per claim**.
Do not try to show everything on one image; that makes each image unreadable.

**Examples of correct splitting:**
- "Container is too narrow" → sub-pair a: annotate container width only
- "One column is wider than others" → sub-pair b: annotate that specific column's width only
- "Row gap is too large" → sub-pair c: annotate the gap space only

**Examples of incorrect approach (avoid):**
- Annotating the container AND all its children in one image
- Adding labels for properties not directly relevant to the claim
- Putting 4+ annotations in one image

**Naming:**
- One claim: `issue-<n>-dev.png` / `issue-<n>-standard.png`
- Multiple claims: `issue-<n>a-dev.png` / `issue-<n>a-standard.png`, then `issue-<n>b-…`, etc.

#### Annotation types — choose the right tool

Use `scripts/annotate.mjs`. Each annotation object has a `type` field:

**`"type": "width"`** — horizontal dimension bracket drawn below the element.
Use this to prove "this element is N px wide". Clean and unambiguous.
```json
{ "rect": {...}, "color": "red", "type": "width", "label": "width: 278px" }
```

**`"type": "height"`** — vertical dimension bracket drawn to the right of the element.
Use this to prove "this element is N px tall".
```json
{ "rect": {...}, "color": "green", "type": "height", "label": "height: 166px" }
```

**`"type": "box"`** (default) — border/fill rectangle with a floating label.
Use this to identify an element and list 2–3 of its properties.
```json
{ "rect": {...}, "color": "green", "type": "box", "highlight": "border", "label": ["padding-top: 12px", "padding-bottom: 12px"] }
```

**Choose `width`/`height` over `box` whenever the claim is about a dimension.** Dimension
brackets are visually cleaner and more direct than a floating label box for proving sizes.

#### Annotation label rules

**Each screenshot describes only its own page's state** — no cross-page references.
- `width: 278px` ✓
- `margin-left: 20px` ✓
- `width: 278px (expected 330px)` ✗ — references the other page
- `class: _58b44ba9d8862103-info` ✗ — not runtime state
- `<div> flex row` ✗ — not runtime state

#### Workflow

Annotations are injected directly into the live DOM via `annotate.mjs`, which connects to the
browser over CDP. The browser renders the overlay and takes the screenshot, so DPR scaling is
handled natively — no coordinate conversion required.

1. **Scroll to top first, then measure elements.**
   Before measuring any element, scroll the tab to the top using `eval.mjs`:
   ```bash
   node .comate/skills/chrome-cdp/scripts/eval.mjs \
     --tab <TAB_ID> --cdp localhost:9222 \
     --script 'window.scrollTo(0, 0)'
   ```
   Wait 300ms. With `scrollY = 0`, `getBoundingClientRect()` coordinates are already page-absolute
   and can be passed directly to `annotate.mjs`.

2. **Find the right element — verify before using.**
   Use `eval.mjs` to locate the target element and check it is actually the element you intend:
   ```bash
   node .comate/skills/chrome-cdp/scripts/eval.mjs \
     --tab <TAB_ID> --cdp localhost:9222 \
     --script 'JSON.stringify((function() {
       const el = document.querySelector("...");
       const r = el.getBoundingClientRect();
       return { text: el.textContent.slice(0, 60),
                x: r.left, y: r.top, width: r.width, height: r.height };
     })())'
   ```
   If the text content doesn't match what you expect, or if `querySelectorAll` returns multiple
   matches, narrow the selector. Always confirm the element contains the visual content you are
   trying to annotate.

   **Check for duplicates in the page.** Many pages have header/filter bars that share class names
   with card internals. Always verify there is only ONE element matching your selector that is
   inside the content you care about. If `querySelectorAll` returns more than one match, iterate
   and pick the one whose text contains the expected data (e.g., a percentage or monetary value)
   and whose `y` coordinate is BELOW the search/filter bar.

3. For each sub-pair, build a minimal annotations JSON — typically **one entry**.

4. Run `annotate.mjs` with `--tab <tabId>` and `--crop 150`.
   The script scrolls to top, injects the SVG overlay into the DOM, takes a cropped screenshot
   via CDP, then removes the overlay — all in one step. No separate raw screenshot needed.
   ```bash
   node <SKILL_DIR>/scripts/annotate.mjs \
     --cdp    http://localhost:9222 \
     --tab    <DEV_TAB or STD_TAB id> \
     --output issue-<n>[a|b|c]-<dev|standard>.png \
     --crop   150 \
     --annotations '[{"rect":{"x":...,"y":...,"width":...,"height":...},"color":"red","type":"width","label":"width: 278px"}]'
   ```
   150px of padding ensures the annotated element's parent container (e.g., the card it lives in)
   is visible in the crop, so the reader can identify what they are looking at.

   The `--tab` value is the tab's `id` field from `http://localhost:9222/json`, or the full
   `webSocketDebuggerUrl`. The `--cdp` flag defaults to `http://localhost:9222`.

5. **Read the output image** and verify:
   - The annotated element is clearly visible and its content is recognisable (e.g., you can see the stat numbers, not just an empty region or page banner)
   - The element outline/bracket aligns with actual page content
   - If the highlighted area appears to be in the wrong place (e.g., over a page header instead of a game card), re-query with a more specific selector and regenerate.

## Output

Return exactly:

1. How to programmatically locate the relevant element(s) on the standard page
2. How to locate the corresponding element(s) on the dev page
3. The specific computed style properties that differ, with exact values from each page
4. A numerical calculation proving those values explain the visual gap
5. Absolute paths to both annotated screenshots and a brief description of what each shows
