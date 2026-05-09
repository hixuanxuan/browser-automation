/**
 * image-diff.mjs — generate side-by-side comparison and pixel diff between two VET images.
 *
 * Usage:
 *   node image-diff.mjs --standard <std.png> --dev <dev.png> --output-dir <dir>
 *                       [--threshold <0-255>]  pixel difference threshold (default: 30)
 *                       [--width <px>]         normalize both images to this width before diffing
 *                                              (default: use the wider of the two images)
 *
 * Outputs written to <output-dir>/:
 *   side-by-side.png  — standard (left) and dev (right) scaled to the same width
 *   diff-pixel.png    — pixels that differ by > threshold shown in red; matching pixels dimmed
 *                       Both images are cropped to the same height (the shorter of the two) before diffing.
 *
 * Both images are scaled proportionally to the same target width, then cropped to the same height
 * (the shorter of the two) before pixel comparison. Aspect ratios are preserved.
 */

import sharp from 'sharp';
import {writeFile, mkdir} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {arg} from './cdp.mjs';

const stdPath = arg('standard');
const devPath = arg('dev');
const outputDir = arg('output-dir');
const threshold = parseInt(arg('threshold') ?? '30', 10);
const targetWArg = arg('width');

if (!stdPath || !devPath || !outputDir) {
    console.error(
        'Usage: node image-diff.mjs --standard <std.png> --dev <dev.png> --output-dir <dir> [--threshold <n>] [--width <px>]'
    );
    process.exit(1);
}

await mkdir(resolvePath(outputDir), {recursive: true});

const stdMeta = await sharp(stdPath).metadata();
const devMeta = await sharp(devPath).metadata();

console.log(`Standard: ${stdMeta.width}×${stdMeta.height}`);
console.log(`Dev:      ${devMeta.width}×${devMeta.height}`);

// Target width: explicit --width flag, or the wider of the two images
const targetW = targetWArg
    ? parseInt(targetWArg, 10)
    : Math.max(stdMeta.width, devMeta.width);

// Scale both images proportionally to targetW
const stdScaledH = Math.round(stdMeta.height * targetW / stdMeta.width);
const devScaledH = Math.round(devMeta.height * targetW / devMeta.width);

const stdResized = await sharp(stdPath).resize(targetW, stdScaledH).toBuffer();
const devResized = await sharp(resolvePath(devPath)).resize(targetW, devScaledH).toBuffer();

console.log(`Normalized to width=${targetW}: standard=${targetW}×${stdScaledH}, dev=${targetW}×${devScaledH}`);

// ── Side-by-side ─────────────────────────────────────────────────────────────
const totalW = targetW * 2;
const totalH = Math.max(stdScaledH, devScaledH);

const sideBySide = await sharp({
    create: {width: totalW, height: totalH, channels: 4, background: {r: 20, g: 20, b: 20, alpha: 1}},
})
    .composite([
        {input: stdResized, left: 0, top: 0},
        {input: devResized, left: targetW, top: 0},
    ])
    .png()
    .toFile(resolvePath(outputDir, 'side-by-side.png'));

console.log(`Saved: side-by-side.png`);

// ── Pixel diff ────────────────────────────────────────────────────────────────
// Crop both images to the same height (the shorter of the two) before comparing.
const diffH = Math.min(stdScaledH, devScaledH);

const stdRaw = await sharp(stdResized).extract({left: 0, top: 0, width: targetW, height: diffH}).removeAlpha().raw()
    .toBuffer();
const devRaw = await sharp(devResized).extract({left: 0, top: 0, width: targetW, height: diffH}).removeAlpha().raw()
    .toBuffer();

const diffW = targetW;
const ch = 3;
const pixelCount = diffW * diffH;
const diffBuf = Buffer.alloc(pixelCount * ch);

let diffCount = 0;

for (let i = 0; i < pixelCount; i++) {
    const si = i * ch;
    const dr = Math.abs(stdRaw[si] - devRaw[si]);
    const dg = Math.abs(stdRaw[si + 1] - devRaw[si + 1]);
    const db = Math.abs(stdRaw[si + 2] - devRaw[si + 2]);
    const maxDiff = Math.max(dr, dg, db);

    if (maxDiff > threshold) {
        diffBuf[si] = 255;
        diffBuf[si + 1] = 0;
        diffBuf[si + 2] = 0;
        diffCount++;
    }
    else {
        // Matching: show dev pixel dimmed
        diffBuf[si] = Math.round(devRaw[si] * 0.28);
        diffBuf[si + 1] = Math.round(devRaw[si + 1] * 0.28);
        diffBuf[si + 2] = Math.round(devRaw[si + 2] * 0.28);
    }
}

await sharp(diffBuf, {raw: {width: diffW, height: diffH, channels: ch}})
    .png()
    .toFile(resolvePath(outputDir, 'diff-pixel.png'));

const pct = ((diffCount / pixelCount) * 100).toFixed(1);
console.log(`Saved: diff-pixel.png  (${diffW}×${diffH}, ${pct}% pixels differ, threshold=${threshold})`);
