---
name: figma-to-html
description: >
  Export Figma design layers to HTML + images based on a natural language description.
  Use this skill whenever a user provides a Figma URL and wants to extract specific layers,
  convert Figma designs to HTML, or find and export matching design components from a Figma file.
  Triggers on: Figma URL + description of what to extract, "从Figma导出", "Figma转HTML",
  "extract from Figma", "Figma layer export", or any request involving Figma design-to-code conversion.
---

# Figma to HTML

Export specific Figma design layers to standalone HTML files with accompanying image assets, based on a natural language description of what the user needs.

## Prerequisites

- Figma personal access token (set as `FIGMA_TOKEN` env var, or the user provides it)
- Username for the internal convert API (optional, set as `FIGMA_USERNAME` env var)
- The bundled script `scripts/convert-node.mjs` handles the full pipeline: HTML conversion + image download
- The bundled script `scripts/export-image.mjs` exports a single node as an image (PNG/JPG/SVG/PDF)

## Workflow

### Step 1: Parse the Figma URL

Extract the **file key** and optional **node-id** from the Figma URL the user provides.

URL format:
```
https://www.figma.com/design/{FILE_KEY}/{file_name}?node-id={NODE_ID}&...
```

- `FILE_KEY`: the segment after `/design/` — used for API calls
- `NODE_ID`: the `node-id` query parameter — optional, if present the user already knows which node

### Step 2: Fetch top-level layers

If the user did NOT provide a specific node-id, call the Figma API to list the file's top-level layers so you can match against the user's description:

```bash
curl -s "https://api.figma.com/v1/files/{FILE_KEY}?depth=1" \
  -H "X-Figma-Token: {TOKEN}"
```

The response contains `document.children` — these are the top-level pages/frames. For each page, look at its `children` for the actual design frames. Collect all frame names and their node IDs.

If the user DID provide a node-id, skip this step and go directly to Step 4 with that node.

### Step 3: Match layers to the user's description

Based on the user's natural language description, select the most relevant top-level layers from the list. Consider:

- Layer names (often in Chinese or English, describing the UI component)
- Layer types (FRAME, COMPONENT, INSTANCE, GROUP, etc.)
- The semantic meaning of the user's request

Present the selected layers to the user for confirmation before proceeding. Format:

```
Found matching layers:
1. [Layer Name] (ID: xxx, Type: FRAME)
2. [Layer Name] (ID: yyy, Type: COMPONENT)
```

Ask: "Export these layers?"

### Step 4: Convert each layer to HTML + images

For each selected layer, run the bundled conversion script:

```bash
node {SKILL_PATH}/scripts/convert-node.mjs \
  --figma-url "https://www.figma.com/design/{FILE_KEY}/{name}?node-id={NODE_ID}" \
  --token "{TOKEN}" \
  --username "{USERNAME}" \
  --output "{OUTPUT_DIR}"
```

Parameters:
- `--figma-url`: The full Figma URL for this specific node (must include node-id)
- `--token`: Figma personal access token (from `FIGMA_TOKEN` env var or user input)
- `--username`: Username for the convert API (from `FIGMA_USERNAME` env var or default)
- `--output`: Output directory path
- `--scale`: Image export scale factor, default `1`. Use `2` for retina/2x images

The script creates a directory per node:
```
{output}/
  {node-name}/
    index.html          # The converted HTML
    assets/
      image_1.png       # Referenced images
      image_2.png
      ...
```

### Step 5: Summarize results

After conversion, report to the user:
- Which layers were exported
- The output directory paths
- How many images were downloaded per layer
- Any failures or missing images

## Export as image

When the user wants a screenshot/image of a Figma node instead of HTML, use `scripts/export-image.mjs`:

```bash
node {SKILL_PATH}/scripts/export-image.mjs \
  --figma-url "https://www.figma.com/design/{FILE_KEY}/{name}?node-id={NODE_ID}" \
  --token "{TOKEN}" \
  --scale 2 \
  --format png \
  --output "{OUTPUT_PATH}"
```

Parameters:
- `--figma-url`: Full Figma URL (must include node-id)
- `--token`: Figma personal access token
- `--scale`: Export scale factor, default `2`
- `--format`: Image format — `png`, `jpg`, `svg`, or `pdf` (default: `png`)
- `--output`: Output file path (default: `./{node-id}.{format}`)

This is useful when the user wants a visual preview, a design screenshot, or needs to inspect what a node looks like before deciding to export as HTML.

## Token and username resolution

Resolve the Figma token and username in this order:
1. If the user provides them directly in the conversation, use those
2. Check environment variables `FIGMA_TOKEN` and `FIGMA_USERNAME`
3. Check the `.env` file in the project root directory (parse `KEY=VALUE` lines; look for `FIGMA_TOKEN` and `FIGMA_USERNAME`)
4. If still not found, ask the user for the token (required) and username (optional)

## Notes

- The convert API is an internal service at `http://figma-restapi-server.sandbox.ee-fe.appspace.baidu.com/api/convert`
- Image assets are downloaded via the official Figma Images API (`https://api.figma.com/v1/images/{fileKey}?ids=...&format=png&scale={scale}`)
- Some images may fail to download (vector-only nodes, empty layers) — this is normal. Expect ~90% success rate
- The HTML uses absolute positioning and inline styles, making it self-contained but not suitable as production code without refactoring
- If a Figma URL already has a node-id, skip the layer listing and matching steps — just convert directly
- Figma node-id format: URLs use dashes (`0-7067`) but the API returns colons (`0:7067`). The convert API accepts the URL as-is (with dashes)
