# Browser Automation Skills for AI-Driven Quality Verification

A collection of browser automation skills for AI agents to perform automated quality verification — covering visual diff, DOM assertions, screenshot capture, and UI regression detection. 

[中文](README.zh.md)

---

## Skills

### `visual-diff` — Figma Visual Diff

Intelligently compare a Figma design against a real development page.

- Export a specified Figma node to HTML as the reference baseline.
- Open the real development page in a browser and align the target element with the Figma HTML.
- **Intelligently** generate VET (Visual Expression Tree — a structure that marks semantic elements as colored blocks), align both pages' VETs, and produce 2 original screenshots + 2 VET screenshots + 2 diff images.
- Identify N visual issues from the comparison; launch one independent Subagent per issue to confirm and quantify it (spacing, font size, color, etc.).
- For confirmed issues, annotate the page, capture a screenshot, and summarize the findings.

**Skill composition:**

- `chrome-cdp`: Low-level Chrome automation via CDP.
- `element-screenshot`: Captures a specific element to avoid noise from a full-page screenshot.
- `figma-to-html`: Given a Figma URL, parses the file and node, then generates a **near-perfect HTML reconstruction** of that single node.
- `vet-generator`: Generates and aligns VETs for both pages (Figma HTML and dev HTML), producing 6 screenshots.
- `vet-investigation`: Deep analysis of the 6 screenshots to surface differences as natural-language issue descriptions.
- `visual-issue-clarification`: Analyzes one specific issue, quantifies it via DOM inspection, annotates the page, and captures evidence.
- `visual-diff`: Top-level orchestrator that drives the entire workflow.

**Input examples:**

Using a Figma design file:
> Design: https://www.figma.com/design/xxx?node-id=123-456  
> Dev page: https://localhost:3000/xxx — target selector `.foo > .bar`

Using a live webpage directly:
> Design page: https://localhost:3001  
> Dev page: https://localhost:3000/xxx — target selector `.foo > .bar`

A `FIGMA_TOKEN` is required when using Figma as input. It can be set in the `FIGMA_TOKEN` environment variable, in a `.env` file at the project root, or passed directly in the conversation.

For design internals, see [`figma-to-verify/DESIGN.md`](figma-to-verify/DESIGN.md).

---

### `visual-verify` — Browser-as-the-Single-Source-of-Truth for Frontend Acceptance

**Core principle: the correctness of every frontend change is determined solely by what the browser actually renders.** Static analysis, unit tests, and lint are supporting tools — only what appears in the browser is what the user actually sees. `visual-verify` enables agents to verify any frontend change the same way a human tester would: by opening a real browser and checking the live page.

This is not just "take a screenshot after a UI change." It is a complete **browser-based agent acceptance workflow** covering the full frontend development lifecycle:

**Structure & rendering**
- Whether elements exist, are visible, are occluded, or overflow their containers
- Whether dimensions, positions, alignment, and spacing match expectations
- Layout edge cases: text truncation, scroll containers, sticky/fixed positioning

**Interaction & state**
- Whether click, fill, and navigation actions trigger the correct page changes
- Whether dynamic content (tab switches, loading states, expand/collapse, conditional rendering) behaves as expected
- Validation of intermediate states: form errors, disabled states, loading indicators

**Regression & safety net**
- Whether a change introduced unintended visual regressions (pixel-level diff against a baseline screenshot)
- Whether the browser console produced new errors or warnings
- Whether the page state remains consistent across repeated interactions

**Mechanism**
- Assertions are written as JSON contracts — statically lintable, reusable, and versionable
- Annotated screenshots are first-class evidence for spatial UI problems, not a fallback
- Persistent memory is maintained across tasks (stable selectors, timing, known quirks), reducing repeated exploration
- Each task produces a `contract.md` acceptance record including screenshot paths, assertion results, and a final verdict

For full usage, see [`visual-verify/SKILL.md`](visual-verify/SKILL.md).

---

## Skill Dependency Map

```
visual-diff
└── figma-to-html / chrome-cdp / element-screenshot / vet-generator / vet-investigation / visual-issue-clarification

visual-verify
└── chrome-cdp + scripts/ (DOM assertions, screenshots, annotations, image diff, etc.)
```
