/**
 * Take a clipped screenshot at a fixed (x, y, width, height) in the page.
 *
 * Usage:
 *   node clip-screenshot.mjs --output <path.png> --x <n> --y <n> --w <n> --h <n>
 *                             [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 */

import {writeFile} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {openSession, resolveTab, arg} from './cdp.mjs';

const output = arg('output');
const x = parseFloat(arg('x') || '0');
const y = parseFloat(arg('y') || '0');
const w = parseFloat(arg('w') || '800');
const h = parseFloat(arg('h') || '600');
const cdpHost = arg('cdp') || 'localhost:9222';

if (!output) {
    console.error('Usage: node clip-screenshot.mjs --output <path.png> --x <n> --y <n> --w <n> --h <n>');
    process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

const clip = {x, y, width: w, height: h, scale: 1};

const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip,
});

cdp.close();

const outPath = resolvePath(output);
await writeFile(outPath, Buffer.from(shot.data, 'base64'));
console.log(`Saved: ${outPath}`);
