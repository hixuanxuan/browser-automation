# Contract Format Reference

Checkpoint contracts are executable assertions. Keep them small, observable, and tied to targets already recorded in `.verify/visual-notes.md` or just inspected in the browser.

Do not add `dim` / category labels. Use clear `desc` text instead.

---

## Contract Formats

### Flat array — single-state checks

Use when the page is already in the right state and you just need to assert:

```json
[
  { "id": "V1", "type": "visible",  "selector": ".panel", "desc": "Panel is visible" },
  { "id": "V2", "type": "clipping", "selector": ".panel", "desc": "Panel is not clipped by ancestor" },
  { "id": "V3", "type": "rect",     "selector": ".panel", "desc": "Panel height >= 280px", "minHeight": 280 },
  { "id": "V4", "type": "content",  "selector": ".tab-bar", "desc": "At least 2 tabs", "minChildren": 2, "childSelector": ".tab-item" }
]
```

### Scenario — multi-step flows

Use when the checkpoint involves user interactions, state transitions, or end-to-end correctness. Each step has an `action`, followed by assertions that verify the resulting state:

```json
{
  "id": "CP1",
  "desc": "User opens panel, switches tab, verifies content, then closes",
  "steps": [
    {
      "desc": "Open panel",
      "action": { "type": "click", "selector": ".panel-trigger" },
      "assertions": [
        { "id": "V1", "type": "visible",  "selector": ".panel", "desc": "Panel appears" },
        { "id": "V2", "type": "clipping", "selector": ".panel", "desc": "Panel is not clipped" },
        { "id": "V3", "type": "custom", "desc": "Trigger becomes active",
          "script": "const b = document.querySelector('.panel-trigger'); return { pass: b.classList.contains('active'), reason: b.className }" }
      ]
    },
    {
      "desc": "Switch to second tab",
      "action": { "type": "click", "selector": ".tab-item:nth-child(2)" },
      "assertions": [
        { "id": "V4", "type": "custom", "desc": "Tab 2 becomes selected",
          "script": "const t = document.querySelector('.tab-item:nth-child(2)'); return { pass: t.classList.contains('active'), reason: t.className }" },
        { "id": "V5", "type": "content", "desc": "Tab 2 content renders", "selector": ".panel-content", "minChildren": 1 }
      ]
    },
    {
      "desc": "Close panel",
      "action": { "type": "click", "selector": ".panel-trigger" },
      "assertions": [
        { "id": "V6", "type": "custom", "desc": "Panel dismisses",
          "script": "const p = document.querySelector('.panel'); const gone = !p || getComputedStyle(p).display === 'none'; return { pass: gone, reason: p ? getComputedStyle(p).display : 'removed' }" }
      ]
    }
  ]
}
```

### Array of scenarios

Pass multiple scenarios in one file — `dom-assert.mjs` runs them in order:

```json
[
  { "id": "CP1", "desc": "...", "steps": [...] },
  { "id": "CP2", "desc": "...", "steps": [...] }
]
```

---

## Assertion Types

| type | Required fields | Optional fields |
|---|---|---|
| `exists` | selector | filter |
| `visible` | selector | filter |
| `rect` | selector | minWidth, minHeight, maxWidth, maxHeight, filter |
| `overflow` | selector | allowX (default false), allowY (default false), filter |
| `clipping` | selector | filter |
| `content` | selector | contains, minChildren, childSelector, filter |
| `icon` | selector | filter |
| `occlusion` | selector | filter |
| `custom` | script | — |

`custom` script must return a boolean or `{ pass: boolean, reason: string }`.

Unsupported examples: `not_exists`, `not_disabled`. Use `custom` for negative checks and disabled-state checks.

---

## Action Types (scenario steps)

| type | Required fields | Optional fields |
|---|---|---|
| `click` | selector | filter |
| `fill` | selector, value | filter |
| `wait` | selector | timeout (ms, default 5000), filter |
| `navigate` | url | — |
| `eval` | script | — |

`wait` must include a selector. A bare timeout wait is invalid.

---

## Target Filter

`dom-assert.mjs` supports a small `filter` object for actions and selector-based assertions. It applies after `document.querySelectorAll(selector)`:

```json
{ "selector": "button", "filter": { "text": "重新分析" } }
```

Supported filter keys:

| key | Meaning |
|---|---|
| `text` | Exact trimmed `textContent` match |
| `includes` | Trimmed `textContent` contains substring |
| `ariaLabel` | Exact `aria-label` match |
| `role` | Exact `role` match |

Prefer `filter` when text/aria/role is more stable than a generated class name.

---

## Recommended Custom Patterns

**Element absent / no error text**

```json
{
  "id": "V1",
  "type": "custom",
  "desc": "页面不出现 400 错误",
  "script": "const text = document.body.innerText; return { pass: !text.includes('400'), reason: text.includes('400') ? '400 found' : 'ok' }"
}
```

**Button enabled**

```json
{
  "id": "V2",
  "type": "custom",
  "desc": "重新分析按钮可用",
  "script": "const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '重新分析'); return { pass: !!btn && !btn.disabled, reason: btn ? 'disabled=' + btn.disabled : 'button not found' }"
}
```
