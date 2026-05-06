/**
 * Pad two PNG images to the same width so they can be passed to diff.mjs.
 *
 * The narrower image is extended on the right with a white background.
 * Both files are modified in-place.
 *
 * Usage:
 *   node normalize-width.mjs <img1.png> <img2.png>
 */

import sharp from 'sharp';
import { resolve } from 'path';
import { rename } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const [,, img1Path, img2Path] = process.argv;

if (!img1Path || !img2Path) {
  console.error('Usage: node normalize-width.mjs <img1.png> <img2.png>');
  process.exit(1);
}

const abs1 = resolve(img1Path);
const abs2 = resolve(img2Path);

const [meta1, meta2] = await Promise.all([
  sharp(abs1).metadata(),
  sharp(abs2).metadata(),
]);

const targetWidth = Math.max(meta1.width, meta2.width);

async function padToWidth(imgPath, currentWidth, currentHeight) {
  if (currentWidth >= targetWidth) {
    console.log(`${imgPath}: already ${currentWidth}px wide, no change needed`);
    return;
  }
  const tmp = join(tmpdir(), `normalize-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await sharp(imgPath)
    .extend({
      right: targetWidth - currentWidth,
      top: 0, bottom: 0, left: 0,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toFile(tmp);
  await rename(tmp, imgPath);
  console.log(`Padded ${imgPath}: ${currentWidth} → ${targetWidth}px`);
}

await Promise.all([
  padToWidth(abs1, meta1.width, meta1.height),
  padToWidth(abs2, meta2.width, meta2.height),
]);

console.log(`Done. Both images are now ${targetWidth}px wide.`);
