### Figma To Verify

[中文](DESIGN.zh.md)

## Overview

### Purpose

- Export a specified Figma node to HTML as the reference baseline.
- Open the real development page in a browser and align the target element with the Figma HTML.
- **Intelligently** generate VET (Visual Expression Tree — a structure that marks semantic elements as colored blocks), align both pages' VETs, and produce 2 original screenshots + 2 VET screenshots + 2 diff images.
- Identify N visual issues from the comparison.
- Launch one Subagent per issue to confirm and quantify it (spacing, font size, color, etc.), then annotate the page and capture a screenshot for confirmed issues.
- Summarize all findings and report back.

### Skill Composition

- `chrome-cdp`: Low-level Chrome automation via CDP.
- `element-screenshot`: Captures a specific element to avoid noise from a full-page screenshot.
- `figma-to-html`: Given a Figma URL, parses the file and node, then generates a **near-perfect HTML reconstruction** of that single node.
- `vet-generator`: Generates and aligns VETs for both pages (Figma HTML and dev HTML), producing 6 screenshots.
- `vet-investigation`: Deep analysis of the 6 screenshots to surface differences as natural-language issue descriptions.
- `visual-issue-clarification`: Analyzes one specific issue, quantifies it via DOM inspection, annotates the page, and captures evidence.
- `visual-diff`: Top-level orchestrator that drives the entire workflow.

### Inputs

- Figma design file — e.g. `https://www.figma.com/design/xxxx/xxxxxxx?node-id=4676-13498&t=AGxU7x7rbqT7rGta-0`, which contains:
    - File Key: `xxxxxxx`
    - Node ID: `4676-13498`
- A development page to inspect, consisting of:
    - A directly accessible URL
    - A CSS selector that **uniquely identifies the target element**

A Figma Token is required when using Figma as input. It can be set in the `FIGMA_TOKEN` environment variable, in a `.env` file at the project root, or passed directly in the conversation.

If you have already exported the Figma design to HTML, you can supply that HTML file as the source page instead.

**Using Figma as input:**

> Design: https://www.figma.com/design/xxx?node-id=123-456  
> Dev page: https://localhost:3000/xxx — target selector `.foo > .bar`

**Using a live webpage directly:**

> Design page: https://localhost:3001  
> Dev page: https://localhost:3000/xxx — target selector `.foo > .bar`

## Internal Implementation

### Figma Page Generation

A Figma design is typically a document with a corresponding JSON structure, but that structure cannot be visualized or opened in a browser — which is fatal for all subsequent browser-based operations.

The first step of the entire pipeline is therefore to convert Figma into an "HTML page that faithfully reproduces the design." This page does not need clean code structure; its only responsibility is **accurate visual reproduction**.

This step uses an F2C service (built on EE) that accepts the Figma URL, Figma Token, and Node ID, auto-exports to HTML, downloads any embedded images, and produces a local **design-reference HTML file**.

This step is largely programmatic; the LLM is only used to parse user input and extract the relevant parameters.

- [ ] Not yet implemented: special handling for large designs.

### Environment Setup

The entire inspection process involves heavy interaction with two pages — the design page and the development page. Full control over the browser and both pages is essential. The `chrome-cdp` skill handles connecting to any CDP-enabled browser (local Chrome, headless Chrome, NoVNC, etc.) and enforces the following workflow constraints in the main skill:

1. **Both pages must be opened in two independent tabs** that are used for the entire session, preventing conflicts from external interference.
2. Based on the user's request, prepare both pages in advance — e.g. "navigate to feature X, click tab Y" — before analysis begins.

A typical user instruction:

> In the dev page, click the "Games" tab and analyze the tab area.

This single sentence implies page navigation, click interaction, area analysis, and screenshot capture — all of which a model-driven agent handles well.

### Page Screenshot

A design file usually targets a specific section of a page, not the whole thing. But the development page is complete. To perform the inspection and comparison we need to:

> Extract a section of the real development page and compare it to the design.

The first key challenge here is scoped screenshotting. CDP's default captures the full page, so `element-screenshot` adds a specialized capability: targeting a specific element. Its implementation essentially **sets all other elements to `visibility: hidden`, takes the screenshot, then restores them**.

- [ ] Not yet implemented: auto-detecting the corresponding region from the design page.

### VET Generation

During page inspection, directly comparing raw screenshots is unreliable — especially with pixel-diff algorithms — because dynamic content (images, text, structure) produces massive amounts of meaningless noise.

![side-by-side](../DESIGN.assets/side-by-side.png)

As shown above, differences in images, text, and structure make the pixel diff almost useless for identifying real layout issues.

VET (Visual Expression Tree) addresses this by **replacing semantic elements with solid-color blocks**, converting DOM content into a purely structural and hierarchical representation. Here is what the design page looks like after VET processing:

<img src="../DESIGN.assets/vet-standard.png" alt="vet-standard" style="zoom:25%;" />

All dynamic content disappears, leaving a clear structural view. Applying the same treatment to both the design and the development page should in theory yield a clean **layout and position diff**.

In practice, however, things are not so straightforward. Real pages have substantial DOM differences from the design, so the same VET algorithm applied to two different pages may produce **completely different regions and colors** — making direct comparison impossible.

To solve this, `vet-generator` became the heaviest component in the pipeline: an **agent-driven VET generation & alignment** capability. Its rough workflow:

1. Run VET **programmatically** on the **design page** first as a fixed baseline; save the result as JSON.
2. An agent analyzes the DOM structure of both pages and uses the model to assign **semantically matching elements the same color**.
3. Take screenshots and compare with the baseline VET. If semantically equivalent elements have mismatched colors or different coverage (e.g. one layer missed, causing content to bleed out), re-run the labeling.
4. Iterate until the VETs are visually aligned enough to support meaningful image diffing.

This step consumes significant tokens and time but produces a usable VET comparison.

<img src="../DESIGN.assets/side-by-side-7873249.png" alt="side-by-side" style="zoom:50%;" />

These two aligned VET images can then be fed to a standard pixel-diff algorithm to compute the difference regions (shown in red).

<img src="../DESIGN.assets/diff-pixel.png" alt="diff-pixel" style="zoom:33%;" />

The red regions may look dramatic, but from the model's perspective they clearly indicate the locations of specific problems — which is very helpful for the subsequent analysis.

The entire VET generation process has no intrinsic value; only the output matters. The analysis therefore runs inside an **isolated Subagent**.

### Issue Identification

After `vet-generator` completes, the context contains 6 images:

1. Design page HTML screenshot.
2. Screenshot of the dev page section corresponding to the design.
3. Pixel diff between design and dev page.
4. Design page VET screenshot.
5. Dev page VET screenshot.
6. VET pixel diff between design and dev page.

Each image conveys different information: what it should look like, what it looks like now, the correct hierarchical structure, the actual hierarchical structure, and what the differences are.

In the issue identification phase, `vet-investigation` is a light-process, high-intelligence implementation. It is given only the 6 images as context, plus a crop tool (zoom into a region by coordinates), with some output format requirements and everything else delegated to the model.

The goal of this phase is to surface N issues, each containing:

- Issue index (auto-incremented).
- Natural-language description of the issue.
- VET node color associated with the issue.

This step **does not aim for accuracy**. The model is guided to **raise issues aggressively and generously**, even if some turn out to be non-issues. The goal here is **completeness, not precision**. These raw issues are then fed into the per-issue analysis phase.

Like VET generation, issue identification only needs the output, so it also runs inside an **isolated Subagent**.

### Issue Analysis

The key requirements for issue analysis:

1. No contamination from prior analysis context.
2. Enough context space for thorough, detailed investigation.

For these reasons, **each issue gets its own dedicated Subagent** running in parallel.

Analysis is driven by the `visual-issue-clarification` skill, which receives a specific issue (index, description, VET node color) and aims to:

1. Carefully analyze the issue from both DOM and visual perspectives, **ruling out issues that don't actually exist**.
2. For real issues, quantify them via DOM inspection — exact margins, real font sizes, etc. — **reading only computed runtime styles, not static CSS properties**.
3. Once an issue is confirmed, annotate it on the page via boxes, labels, etc., and capture a screenshot so **humans can clearly understand the problem**.
4. Based on DOM understanding and confirmed findings, provide **technical root-cause analysis** — which `style`, which `class`, which DOM nesting caused the issue — preparing the groundwork for a fix.

![issue-3b-dev](../DESIGN.assets/issue-3b-dev.png)![issue-5-dev](../DESIGN.assets/issue-5-dev.png)

Thanks to full control over the browser's DOM, this phase can even inject SVG elements directly into the page for annotation.

- [ ] Current rigor is insufficient; "ruling out issues" behavior is not prominent enough.
