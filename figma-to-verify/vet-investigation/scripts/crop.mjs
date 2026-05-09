/**
 * Crop a region from an image and save it as a new file.
 *
 * Usage:
 *   node crop.mjs --input <path> --output <path> --x <n> --y <n> --width <n> --height <n>
 *
 * All coordinates are in pixels. The crop region is clamped to the image bounds automatically.
 */

import sharp from 'sharp';
import {resolve} from 'path';

function arg(name) {
    const idx = process.argv.indexOf('--' + name);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

const input = arg('input');
const output = arg('output');
const x = parseInt(arg('x') ?? '0', 10);
const y = parseInt(arg('y') ?? '0', 10);
const width = parseInt(arg('width'), 10);
const height = parseInt(arg('height'), 10);

if (!input || !output || isNaN(width) || isNaN(height)) {
    console.error('Usage: node crop.mjs --input <path> --output <path> --x <n> --y <n> --width <n> --height <n>');
    process.exit(1);
}

const img = sharp(resolve(input));
const meta = await img.metadata();

// Clamp to image bounds
const left = Math.max(0, x);
const top = Math.max(0, y);
const right = Math.min(meta.width, left + width);
const bottom = Math.min(meta.height, top + height);
const w = right - left;
const h = bottom - top;

await img
    .extract({left, top, width: w, height: h})
    .toFile(resolve(output));

console.log(`Cropped: ${left},${top} ${w}x${h} → ${output}`);
console.log(`Source dimensions: ${meta.width}x${meta.height}`);
