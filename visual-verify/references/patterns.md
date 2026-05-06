# Patterns & FAQ

## Common Patterns

### Popup / floating panel

Use notes first: record the trigger, panel selector, close action, and any failed selectors in `.verify/visual-notes.md`. Because floating panels are spatial UI, capture an annotated screenshot when checking clipping, occlusion, overflow, sticky/fixed overlap, z-index, text wrapping/truncation that affects layout, or dynamic content that changes size/position.

```json
{
  "id": "CP1", "desc": "Panel opens, shows content, and dismisses",
  "steps": [
    {
      "desc": "Open",
      "action": { "type": "click", "selector": ".panel-trigger" },
      "assertions": [
        { "id": "V1", "type": "visible",   "selector": ".panel", "desc": "Panel appears" },
        { "id": "V2", "type": "clipping",  "selector": ".panel", "desc": "Panel is not clipped by overflow" },
        { "id": "V3", "type": "occlusion", "selector": ".panel", "desc": "Panel is not covered by another element" },
        { "id": "V4", "type": "rect",      "selector": ".panel", "desc": "Panel has reasonable size", "minHeight": 200, "minWidth": 300 },
        { "id": "V5", "type": "content",   "selector": ".panel", "desc": "Panel has content", "minChildren": 1 },
        { "id": "V6", "type": "custom",    "desc": "Trigger shows active state",
          "script": "const b = document.querySelector('.panel-trigger'); return { pass: b.classList.contains('active'), reason: b.className }" }
      ]
    },
    {
      "desc": "Close",
      "action": { "type": "click", "selector": ".panel-trigger" },
      "assertions": [
        { "id": "V7", "type": "custom", "desc": "Panel dismisses",
          "script": "const p = document.querySelector('.panel'); const gone = !p || getComputedStyle(p).display === 'none'; return { pass: gone, reason: p ? getComputedStyle(p).display : 'removed' }" }
      ]
    }
  ]
}
```

### Form submit with validation

```json
{
  "id": "CP2", "desc": "Form validates input and shows error / success",
  "steps": [
    {
      "desc": "Submit empty form",
      "action": { "type": "click", "selector": ".form-submit" },
      "assertions": [
        { "id": "V1", "type": "visible", "selector": ".field-error", "desc": "Validation error appears" },
        { "id": "V2", "type": "content", "selector": ".field-error", "desc": "Error message is meaningful", "contains": "required" }
      ]
    },
    {
      "desc": "Fill valid input",
      "action": { "type": "fill", "selector": ".form-input", "value": "valid input" },
      "assertions": []
    },
    {
      "desc": "Resubmit",
      "action": { "type": "click", "selector": ".form-submit" },
      "assertions": [
        { "id": "V3", "type": "custom", "desc": "Error clears after valid submit",
          "script": "const e = document.querySelector('.field-error'); return { pass: !e || getComputedStyle(e).display === 'none', reason: e ? 'still visible' : 'removed' }" },
        { "id": "V4", "type": "visible", "selector": ".success-message", "desc": "Success state is shown" }
      ]
    }
  ]
}
```

### Visual evidence decision

Before writing assertions for a visible UI change, decide whether visual evidence could reveal layout, clipping, overlap, wrapping, truncation, or boundary issues that DOM checks may miss. For floating or layout-sensitive UI, assume annotated evidence is useful and create it before writing the contract. Mark the target and, when known, the blocker/boundary. The default annotation mode is actual visibility: frames and numbers are applied to the element itself, so they are clipped/hidden like the element.

```bash
node scripts/annotate-screenshot.mjs \
  --match "URL_PATTERN" \
  --output .verify/spatial-panel-open.png \
  --mark ".panel" \
  --mark ".sticky-header"
```

After creating the image, inspect it before writing the checkpoint JSON and record a short note. Use `--mode layout-rect` only as a follow-up diagnostic screenshot when you need to compare actual visibility with the element's full theoretical layout box:

```bash
node scripts/annotate-screenshot.mjs \
  --match "URL_PATTERN" \
  --mode layout-rect \
  --output .verify/spatial-panel-layout-rect.png \
  --mark ".panel" \
  --mark ".sticky-header"
```

```md
## Visual Evidence
### panel-open
- Screenshot: spatial-panel-open.png
- Marks: 1 target panel, 2 sticky header
- Finding: panel top is clear of the sticky header by 8px
```

### Button by text filter

```json
{
  "id": "CP3", "desc": "Retry button click does not show known errors",
  "steps": [
    {
      "desc": "Click retry",
      "action": { "type": "click", "selector": "button", "filter": { "text": "重新分析" } },
      "assertions": [
        { "id": "V1", "type": "custom", "desc": "No known error text appears",
          "script": "const text = document.body.innerText; const bad = text.includes('400') || text.includes('Can only restart'); return { pass: !bad, reason: bad ? 'error found' : 'ok' }" }
      ]
    }
  ]
}
```

### Icon rendering — flat array

```json
[
  { "id": "V1", "type": "icon",   "selector": ".toolbar .icon", "desc": "Icon has non-zero size" },
  { "id": "V2", "type": "custom", "desc": "No emoji font fallback",
    "script": "const el = document.querySelector('.toolbar .icon'); const font = getComputedStyle(el).fontFamily; return { pass: !font.includes('emoji') && !font.includes('serif'), reason: 'Font: ' + font };" }
]
```

---

## Directory Convention

```text
project-root/
└── .verify/
    ├── visual-notes.md       # rolling notes: targets, dynamic conditions, failed selectors, snippets
    ├── baseline.png          # initial baseline before UI changes when available
    ├── baseline-cp1.png      # screenshot evidence after CP1 passes
    ├── spatial-panel-open.png # annotated evidence for spatial UI when needed
    ├── checkpoint-1.json     # assertions for CP1
    ├── contract.md           # accumulated passed checkpoint log
    ├── scripts/              # reusable verification scripts
    ├── final.png             # screenshot at task completion
    └── diff-cp2/             # pixel diff output
        ├── side-by-side.png
        └── diff-pixel.png
```

Clear `.verify/` and start fresh for each new task unless the user explicitly wants to keep prior evidence.

---

## Exploratory Browser Notes

Before checkpoint JSON exists, use browser commands to explore state and selectors, but keep reusable findings in `.verify/visual-notes.md` as you go.

After each browser command, ask whether you learned a reusable target, failed selector, timing behavior, dynamic state, visual evidence, console issue, or mistake. If yes, append it before the next browser command.

Example note:

```md
## Mistakes / Corrections
### deleteButtonText
- Mistake: exact text selector `删除` failed.
- Correction: actual text contains spacing/newline; use an includes-based custom script.
- Reuse: inspect textContent before exact text filters for this toolbar.

## Timing / State Transitions
### tabSwitch
- Action: click category tab.
- Observed delay or stable marker: wait for selected tab class before asserting content.
- Reuse: do not assert immediately after tab click.
```

Exploratory browser checks are not final verification. Convert stable findings into checkpoint JSON before finishing, or write a `BLOCKED` note explaining why automation is not possible.

---

## FAQ

**Q: Changed a CSS variable/token with wide impact — how to handle?**
A: Write assertions only for elements you explicitly care about. The full-page pixel diff in final verification catches unexpected side effects.

**Q: Target component requires login or specific data state?**
A: Navigate the page to the correct state when taking the baseline. Record the state, route, feature flags, account, and setup steps in `visual-notes.md`.

**Q: Changes span multiple pages?**
A: Create independent notes/checkpoints for each page. Name assertion files like `checkpoint-page-name-1.json`.

**Q: Page hasn't finished hot-reloading when assertions run?**
A: Add a `wait` action with a selector as the first step in your scenario, or use `scripts/wait.mjs` before running assertions. A bare timeout-only wait is invalid.

**Q: A selector failed, but inspection found the right element later?**
A: Record the failed selector and corrected selector in `visual-notes.md` before re-running. This prevents later rounds from repeating the same mistake.

**Q: When should I annotate screenshots?**
A: Before writing assertions for any visible UI change, ask whether a screenshot could reveal layout, clipping, overlap, wrapping, truncation, or boundary issues that DOM assertions may miss. For floating UI, layout-sensitive UI, boundary-sensitive UI, or dynamic UI that changes size/position, assume the answer is yes. If the answer is no, record one sentence in `visual-notes.md` explaining why DOM assertions are enough.

**Q: How do I check browser console output?**
A: Start console collection before or around the interaction being verified. CDP cannot reliably fetch old logs after the fact.

```bash
node scripts/console-check.mjs --match "URL_PATTERN" --duration 3000 --fail-on error --output .verify/console-cp1.json
```

Use `--fail-on none` to collect evidence without failing the command.
