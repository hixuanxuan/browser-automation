#!/usr/bin/env node

import {parseArgs} from 'node:util';
import {writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';

const {values} = parseArgs({
    options: {
        'figma-url': {type: 'string'},
        token: {type: 'string'},
        scale: {type: 'string', default: '2'},
        format: {type: 'string', default: 'png'},
        output: {type: 'string'},
    },
});

const {token, scale, format} = values;
const figmaUrl = values['figma-url'];
const output = values.output;

if (!figmaUrl || !token) {
    console.error(
        'Usage: export-image.mjs --figma-url <url> --token <figma_token> [--scale <n>] [--format png|jpg|svg|pdf] [--output <path>]'
    );
    console.error('  figma-url: Full Figma URL, e.g. https://www.figma.com/design/XXXX/Name?node-id=123-456');
    console.error('  token:     Figma personal access token');
    console.error('  scale:     Export scale factor (default: 2)');
    console.error('  format:    Image format: png, jpg, svg, pdf (default: png)');
    console.error('  output:    Output file path (default: ./{node-name}.{format})');
    process.exit(1);
}

// Parse file key and node-id from Figma URL
function parseFigmaUrl(url) {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const designIndex = parts.indexOf('design') === -1 ? parts.indexOf('file') : parts.indexOf('design');
    if (designIndex === -1 || !parts[designIndex + 1]) {
        throw new Error(`Cannot parse file key from URL: ${url}`);
    }
    const fileKey = parts[designIndex + 1];
    const nodeId = u.searchParams.get('node-id');
    if (!nodeId) {
        throw new Error('URL must contain a node-id parameter');
    }
    return {fileKey, nodeId};
}

const {fileKey, nodeId} = parseFigmaUrl(figmaUrl);

// Convert URL-style node-id (0-7067) to API-style (0:7067)
const apiNodeId = nodeId.replace(/-/g, ':');

console.log(`Exporting node ${nodeId} as ${format} (scale ${scale})...`);

const imagesUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${
    encodeURIComponent(apiNodeId)
}&format=${format}&scale=${scale}`;

const imagesRes = await fetch(imagesUrl, {
    headers: {'X-Figma-Token': token},
});
const imagesData = await imagesRes.json();

if (imagesData.err) {
    console.error('Figma Images API error:', imagesData.err);
    process.exit(1);
}

const s3Url = imagesData.images?.[apiNodeId];
if (!s3Url) {
    console.error('No image URL returned for node', apiNodeId);
    process.exit(1);
}

// Determine output path
const ext = format === 'jpg' ? 'jpg' : format;
const defaultOutput = `./${nodeId}.${ext}`;
const destPath = output || defaultOutput;

await mkdir(dirname(destPath), {recursive: true});

console.log(`Downloading from ${s3Url}...`);
const imgRes = await fetch(s3Url);
if (!imgRes.ok) {
    console.error(`Download failed: HTTP ${imgRes.status}`);
    process.exit(1);
}

const buf = Buffer.from(await imgRes.arrayBuffer());
await writeFile(destPath, buf);

console.log(`Done! Saved to ${destPath} (${(buf.length / 1024).toFixed(1)} KB)`);
