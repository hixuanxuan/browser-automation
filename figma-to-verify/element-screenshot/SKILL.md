---
name: element-screenshot
description: >
  Capture a screenshot of a specific DOM element on an open browser tab using Chrome DevTools Protocol (CDP).
  Use this skill whenever you need to take a screenshot of a single element rather than the full page — for
  visual testing, UI comparison, capturing a component in isolation, or extracting part of a webpage as an image.
  Triggers on: "screenshot element", "capture element", "截取元素截图", "截图某个元素", "截取网页中某个组件",
  visual diff of a specific component, or any task involving element-level screenshots via CDP.
---

# Element Screenshot

Capture a screenshot of a single DOM element via CDP. Clips output to the element's bounding rectangle.

For Chrome setup and tab ID resolution, see the `chrome-cdp` skill.

## Script

```bash
cd .comate/skills/element-screenshot && npm install  # first time only

node screenshot-element.mjs \
  --tab <tabId> \
  --selector <css> \
  --output <path.png> \
  [--cdp localhost:9222] \
  [--no-isolate]
```

## Modes

**Default (isolate)** — hides every element outside the target's ancestry, clips to the element rect, then restores visibility. The `#__vet_overlay__` element (if present) is always preserved.
Use this for clean "original" screenshots.

**`--no-isolate`** — clips only, no hiding. Use *after* injecting a visual overlay (e.g. VET) so the overlay stays visible in the crop.
