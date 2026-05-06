---
name: vet-investigation
description: >
  Analyse VET (Visual Element Tree) overlay images and identify structural visual discrepancies
  between a standard page and a dev page. Given original screenshots, VET overlays, diff images,
  and a VET colour mapping, this skill reads the images and returns a list of distinct issues —
  descriptions only, no measurement. Use this skill to triage what is visually different before
  handing each issue off for detailed clarification. Triggers on: analyse VET diff, identify layout
  issues, triage visual regression, list VET discrepancies, what's different between pages.
---

# VET Investigation

Read VET overlay images and identify structural discrepancies between two pages.
This skill produces a list of issues — it does not measure computed styles or produce annotations.

## Inputs required

- Paths to the images produced by `vet-generator`:
  - 2 original screenshots (standard + dev)
  - 2 VET overlay screenshots (standard + dev)
  - 2 diff images (side-by-side + pixel diff)
- Path to the VET info JSON (colour-to-semantic-role mapping)
- Standard page URL and dev page URL (for context)

## Cropping for detail

VET screenshots are typically large (e.g. 2400×1636). Small elements like nav tabs or indicators are hard to distinguish at full size. Use the `crop.mjs` script to zoom into any region of interest before drawing conclusions:

```bash
cd .comate/skills/vet-investigation && npm install  # first time only

node <SKILL_DIR>/scripts/crop.mjs \
  --input <image-path> \
  --output <cropped-path> \
  --x <left> --y <top> --width <w> --height <h>
```

Crop any area where you need more detail — especially the top navigation, gaps between elements, or any region where the diff shows a difference. Read the cropped image before interpreting.
Coordinates are in pixels; the script clamps automatically to image bounds.

## Process

Read all provided images and the VET mapping JSON. Compare the VET overlays and diff images visually to find blocks that differ in size, position, or presence:

| Visual difference | Likely cause |
|---|---|
| A coloured band present in one VET but not the other | Vertical gap / margin between rows differs |
| A block larger or smaller on one side | Block size (width/height) differs |
| A block shifted horizontally | Horizontal padding/margin differs |
| A block absent on one side entirely | Element present on one page but not the other |

Also consider any structural observations from the VET mapping (element counts, depth distribution, elements present on one page but absent on the other).

## Output

Return a numbered list of 2–5 distinct structural issues. For each issue provide:

- **Issue number** (starting from 1)
- **Plain-language description** of the visual anomaly: where it appears, what differs between
  the VET images, and which page appears to have more or less space
- **Relevant VET colour(s)** involved, mapped to their semantic role from the VET info JSON
