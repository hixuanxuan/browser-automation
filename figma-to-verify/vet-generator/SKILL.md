---
name: vet-generator
description: >
  Generate semantically aligned VET (Visual Element Tree) overlays for two pages (a standard/reference page
  and a dev/implementation page), then produce a pixel diff to reveal layout and structural differences.
  Use this skill when asked to visually compare two pages, check if a UI implementation matches its reference,
  perform a layout diff, or produce VET screenshots for analysis. The key challenge this skill solves is that
  VET's automatic depth-based colour assignment produces inconsistent colour schemes across pages — this skill
  aligns the colours by semantic role so the diff is meaningful.
---

# VET Generator

Produce two VET images that share the same semantic colour scheme, then diff them.

## The Core Problem

VET assigns colours to elements based on their **absolute DOM depth** from `document.body`.
Two pages with the same visual structure but different DOM nesting depths will produce completely
different colour schemes — making a pixel diff useless.

**Example**: On a reference page, a game card `div` sits at DOM depth 7 (→ purple). On the dev page,
the same visual card is wrapped in extra provider/layout components and ends up at depth 14 (→ cyan by
VET's logic). The diff would show "purple vs cyan" as a difference, masking the real layout changes.

The solution: run VET on the **standard page only** to establish the colour scheme, then inject a
**custom overlay** on the dev page that manually assigns the same colours to semantically equivalent elements.

---

## Environment

**Prerequisites** (always verify before starting):
- Chrome running with remote debugging — see `chrome-cdp` skill for setup instructions
- All scripts are in `<SKILL_DIR>/scripts/`
- `ws` and `sharp` npm packages installed: `cd .comate/skills/vet-generator && npm install`

**Script reference:**

| Script | Purpose | Key args |
|---|---|---|
| `screenshot.mjs` | Capture element or full-page PNG | `--tab` `--output` `[--selector]` `[--no-isolate]` |
| `inject-vet.mjs` | Inject VET on a page, write VET_INFO JSON | `--tab` `--output` `[--root]` `[--layers]` `[--reload]` |
| `inject-overlay.mjs` | Inject a custom colour overlay from a config JSON | `--tab` `--config` |
| `image-diff.mjs` | Generate side-by-side + pixel diff PNGs | `--standard` `--dev` `--output-dir` `[--width]` |

`inject-vet.mjs` does **not** reload by default — pass `--reload` explicitly if a clean page state is needed. The overlay is idempotent: calling it twice removes the old overlay and re-injects fresh (no toggle behaviour).

`image-diff.mjs` normalises both images to the same width (wider of the two by default, or `--width <px>`) before diffing, then crops both to the shorter height. Only the overlapping region is diffed; the excess rows of the taller image are not included.

For one-off DOM exploration queries (finding the right selector, checking element dimensions, etc.), use `chrome-cdp`'s eval script — it handles quoting safely:
```bash
node .comate/skills/chrome-cdp/scripts/eval.mjs --tab <tabId> --script "document.querySelector('.foo').getBoundingClientRect().width"
```
Never write temporary `.mjs` files for exploratory queries.

All scripts live in `<SKILL_DIR>/scripts/` and must be run from there or with
their full path (they use relative imports). Use `node <script>` — they are ES modules.

---

## Principles

**Read images, not assumptions.**
After every screenshot, read the image back and look at it. The ground truth is what you can see, not what the DOM structure implies. Adjust your overlay config based on what you observe.

**Inject → screenshot → compare → adjust is one loop.**
There is no strict step ordering. The process is a feedback loop: inject an overlay, take a screenshot, compare it to the standard VET visually, identify which colours are wrong or missing, update the config, re-inject and re-screenshot. Iterate until the colour blocks correspond. Both `inject-vet.mjs` and `inject-overlay.mjs` are idempotent — re-injecting clears the previous overlay automatically.

**Semantic correspondence, not pixel identity.**
The goal is not that the two VET images look identical — the pages may genuinely differ in card count, element sizes, or navigation structure. The goal is that each colour in one image maps to the same semantic role in the other. A card in standard is purple; a card in dev should also be purple. An active tab is
yellow in standard; the corresponding active tab should be yellow in dev.

**Map structurally significant colours only.**
Not every VET colour needs a dev-page counterpart. Focus on colours that represent primary structural elements: page containers, card/list items, navigation items, content titles, action buttons. Skip colours that map to minor decoration, status indicators, or secondary controls whose absence won't affect the structural diff. The rule of thumb: if misaligning this element would hide a real layout bug, map it. Otherwise, omit it and move on.

**Page state is the caller's responsibility.**
`inject-vet.mjs` does not reload by default. Before injecting VET, ensure the page is in the intended state (correct tab active, modal open, scroll position set). If you need a clean reload, pass `--reload` to `inject-vet.mjs`. If the page requires user interaction to reach the target state (e.g., click a nav tab), use `chrome-cdp` to do that first, then inject.

**Use `window.__VET_INFO__` as the semantic analysis source.**
After running `inject-vet.mjs`, the output JSON contains one entry per VET node with: `color`, `rect`, `category`, `depth`, `tag`, `className`, `text`, `cssPath`.
Group entries by colour. For each colour group, understand what it represents: is this the page background? Card containers? A nav tab? A UI control?  This understanding drives the dev-page mapping.

---

## Workflow

### 1 — Establish dedicated tab IDs

If the caller has already provided tab IDs (e.g. `STD_TAB` and `DEV_TAB` passed in the task prompt), use those directly — do not open new tabs.

If no tab IDs are provided, use `chrome-cdp` to open two brand-new tabs and record their IDs before doing anything else.

Either way, fix the IDs at this point and **use them for every subsequent CDP call in the session** — screenshots, reloads, script injections, everything.

**Never re-query the tab list mid-session** to re-derive IDs. If you lose track of an ID, reuse what you recorded — do not look it up again. Re-querying risks picking up a tab opened by a different concurrent task, causing silent cross-task interference.

If a command fails, retry with the same IDs rather than opening replacement tabs.
Replacement tabs introduce new IDs and risk the same concurrency issue.

If the page requires interaction to reach the target state (click a tab, scroll, log in), use `chrome-cdp` to interact with the page using the recorded tab ID **before** taking any screenshots.

### 2 — Original screenshots (baseline)

Capture what both pages actually look like before any overlay, as reference for later comparison.

```bash
# Full page (standard)
node screenshot.mjs --tab <STD_TAB> --output <out>/original-standard.png

# Scoped element (dev) — if comparing a specific component
node screenshot.mjs --tab <DEV_TAB> --selector "<root-selector>" --output <out>/original-dev.png
```

### 3 — Standard page VET

```bash
# Inject VET, export node info (page should already be in target state)
node inject-vet.mjs --tab <STD_TAB> --output <out>/std-vet-info.json \
     [--root "<scope-selector>"] [--layers 2]

# Screenshot the overlay (no-isolate keeps the overlay visible in the crop)
node screenshot.mjs --tab <STD_TAB> --selector "body" --output <out>/vet-standard.png --no-isolate
# or, if VET is scoped to a specific element:
node screenshot.mjs --tab <STD_TAB> --selector "<root-selector>" --output <out>/vet-standard.png --no-isolate
```

Read `vet-standard.png` and `std-vet-info.json` together.  Mentally (or in notes) map each colour to its semantic role.  Example from a real session:

| Colour | Semantic role |
|---|---|
| `#2196F3` blue | Outermost page/component container |
| `#9C27B0` purple | Card items, search bar, filter control |
| `#FF9800` orange | Non-active nav tab text |
| `#FFD600` yellow | Active tab text |
| `#00BCD4` cyan | Icons, secondary UI elements |
| `#795548` brown | First nav item text |
| `#3F51B5` indigo | Active tab underline indicator |

### 4 — Explore dev page DOM

Find which elements on the dev page correspond to each semantic role.
Use `chrome-cdp` to evaluate JavaScript against the recorded DEV_TAB. Useful queries:

- Find elements by approximate size (width/height range) to locate card containers
- Get DOM depth and bounding rect of a candidate element by selector

For each VET colour in the standard, find the corresponding dev selector. Look for:
- Same visual size and position relative to the container
- Same content type (card, button, nav item, icon)
- Similar class name patterns if the pages share a component library

### 5 — Build overlay config

The colours are **already decided** — they live in `std-vet-info.json`.
Your only job here is to find, for each VET node (or group of same-colour nodes),
the corresponding CSS selector on the dev page.

Derive the config directly from `VET_INFO`:

```js
// Pseudocode — do this mentally or with a short inline script
for each unique color in VET_INFO:
    understand what semantic role those nodes play (card? nav tab? search bar?)
    find the CSS selector on the dev page that selects the equivalent element(s)
    emit: { selector: <dev-selector>, color: <color from VET_INFO>, all: <true if repeated> }
```

The resulting config looks like:

```json
{
  "blocks": [
    { "selector": "<dev selector for the outermost container>", "color": "<from VET_INFO>" },
    { "selector": "<dev selector for card items>",              "color": "<from VET_INFO>", "all": true },
    { "selector": "<dev selector for search bar>",             "color": "<from VET_INFO>" }
  ]
}
```

Never invent a colour value. Every `"color"` must be copied verbatim from a `color` field in `std-vet-info.json`. If you can't find a dev-page counterpart for a particular VET colour, omit it — don't substitute a guess.

Save as `<out>/overlay-config.json`.

### 6 — Inject custom overlay and screenshot dev VET

If the dev page requires navigation to a specific state, do that first, then inject the overlay without reloading:

```bash
node inject-overlay.mjs --tab <DEV_TAB> --config <out>/overlay-config.json

node screenshot.mjs --tab <DEV_TAB> --selector "<root-selector>" \
     --output <out>/vet-dev.png --no-isolate
```

Read `vet-dev.png` and compare it visually against `vet-standard.png`.

Ask: does each colour block in the standard find a visually corresponding block in the dev image?
Are there colours present in standard that are absent in dev (or vice versa)?

### 7 — Iterate

If the overlay is wrong — wrong selectors, missing elements, mismatched colours — update `overlay-config.json` and re-run the inject + screenshot loop (Step 6).

The bar for "good enough": same colour blocks appear in both images in semantically matching positions.
It does **not** mean pixel-identical — size differences and count differences are expected and valuable.

### 8 — Generate diff

Once the VET images are semantically aligned:

```bash
node image-diff.mjs \
     --standard <out>/vet-standard.png \
     --dev <out>/vet-dev.png \
     --output-dir <out>/diff
```

This writes `diff/side-by-side.png` and `diff/diff-pixel.png`.

**Reading the pixel diff:**
- **Red pixels** = genuine structural/size differences between the pages
- **Dark (dimmed) pixels** = areas where the pages agree
- Matching colour blocks appearing dark = good alignment
- Solid red blocks = elements present in one page but not the other, or significantly different in size

---

## Overlay Config Tips

**`"all": true`** — use `querySelectorAll` for repeated elements like cards, list items, icons.
Without it, only the first match is painted.

**Selector specificity** — use the most specific selector that reliably targets the right elements. Prefer child/descendant combinators when a class name is reused elsewhere on the page: `div.card-wrapper > span.title` is safer than `span.title` alone. CSS class combos like `.playlet-card._wrapper` are more stable than `:nth-child` chains.

**Order matters** — blocks are painted in order. Larger background blocks should come first so smaller blocks on top are not obscured. (The overlay uses absolute positioning so they layer visually.)

**Unknown elements** — if you can't find the dev-page equivalent of a standard-page colour, omit it.
VET consistency doesn't require 1:1 completeness; unmatched elements simply won't appear in the dev VET, which is informative in itself.

**Scroll state** — `getBoundingClientRect` returns viewport-relative coordinates; the scripts compensate with `scrollX/scrollY`. If the page needs to be scrolled to show the target element, scroll before injecting the overlay.

---

## Output Directory Convention

All outputs go under `.vet/` in the workspace root, one subdirectory per task.
Task directory naming: `<task-name>-<MMDD-HHmm>` (lowercase, hyphen-separated, timestamped).

```
<workspace-root>/
└── .vet/
    └── game-list-0426-1530/
        ├── original-standard.png
        ├── original-dev.png
        ├── std-vet-info.json
        ├── vet-standard.png
        ├── overlay-config.json
        ├── vet-dev.png
        └── diff/
            ├── side-by-side.png
            └── diff-pixel.png
```

Create the task directory at the very start: `mkdir -p .vet/<task-name>/`
