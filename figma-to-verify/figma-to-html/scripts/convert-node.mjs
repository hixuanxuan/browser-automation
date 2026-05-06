#!/usr/bin/env node

import {parseArgs} from 'node:util';
import {writeFile, mkdir} from 'node:fs/promises';
import {dirname, join, basename} from 'node:path';

const {values} = parseArgs({
  options: {
    'figma-url': {type: 'string'},
    token: {type: 'string'},
    username: {type: 'string'},
    scale: {type: 'string', default: '1'},
    output: {type: 'string', default: '.'},
  },
});

const {token, username, output} = values;
const scale = values.scale;
const figmaUrl = values['figma-url'];

if (!figmaUrl || !token) {
  console.error('Usage: convert-node.mjs --figma-url <url> --token <figma_token> [--username <name>] [--output <dir>]');
  console.error('  figma-url: Full Figma URL, e.g. https://www.figma.com/design/XXXX/Name?node-id=123-456');
  console.error('  token:     Figma personal access token');
  console.error('  username:  Username for convert API (optional)');
  console.error('  output:    Output directory (default: current dir)');
  process.exit(1);
}

// Parse file key from Figma URL
// URL format: https://www.figma.com/design/{FILE_KEY}/...?node-id=...
function parseFigmaUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  // /design/{FILE_KEY}/... or /file/{FILE_KEY}/...
  const designIndex = parts.indexOf('design') === -1 ? parts.indexOf('file') : parts.indexOf('design');
  if (designIndex === -1 || !parts[designIndex + 1]) {
    throw new Error(`Cannot parse file key from URL: ${url}`);
  }
  const fileKey = parts[designIndex + 1];
  const nodeId = u.searchParams.get('node-id');
  return {fileKey, nodeId};
}

const {fileKey} = parseFigmaUrl(figmaUrl);

// Step 1: Call convert API to get HTML + image references
console.log(`Converting Figma node to HTML...`);

const convertRes = await fetch('http://figma-restapi-server.sandbox.ee-fe.appspace.baidu.com/api/convert', {
  method: 'POST',
  headers: {'Content-Type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({figmaUrl, token, username: username || 'anonymous'}),
});

const convertData = await convertRes.json();

if (!convertData.success) {
  console.error('Convert API failed:', JSON.stringify(convertData));
  process.exit(1);
}

const {files, importStatements} = convertData.result;
const nodeName = convertData.result.name || 'output';

// Step 2: Write HTML files
const outDir = join(output, nodeName.replace(/[\/\\:*?"<>|]/g, '_'));
await mkdir(outDir, {recursive: true});
await mkdir(join(outDir, 'assets'), {recursive: true});

for (const file of files) {
  const filePath = join(outDir, file.path);
  await mkdir(dirname(filePath), {recursive: true});
  await writeFile(filePath, file.content, 'utf-8');
  console.log(`  Written: ${filePath}`);
}

// Step 3: Download images via Figma Images API
if (importStatements.length > 0) {
  console.log(`Downloading ${importStatements.length} images...`);

  const idToImport = new Map();
  for (const img of importStatements) {
    idToImport.set(img.id, img.importPath);
  }

  const ids = [...idToImport.keys()];
  const BATCH_SIZE = 10;
  let downloaded = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const imagesUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${batchIds.map(encodeURIComponent).join(',')}&format=png&scale=${scale}`;

    const imagesRes = await fetch(imagesUrl, {
      headers: {'X-Figma-Token': token},
    });
    const imagesData = await imagesRes.json();

    if (imagesData.err) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} Figma Images API error:`, imagesData.err);
      continue;
    }

    const batchDownloads = imagesData.images || {};
    for (const [id, s3Url] of Object.entries(batchDownloads)) {
      const importPath = idToImport.get(id);
      if (!importPath || !s3Url) continue;

      const fileName = basename(importPath);
      const destPath = join(outDir, 'assets', fileName);

      try {
        const imgRes = await fetch(s3Url);
        if (!imgRes.ok) {
          console.error(`  Failed to download ${fileName}: HTTP ${imgRes.status}`);
          continue;
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        await writeFile(destPath, buf);
        downloaded++;
      } catch (e) {
        console.error(`  Failed to download ${fileName}: ${e.message}`);
      }
    }

    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ids.length / BATCH_SIZE)}: ${downloaded} downloaded so far`);
  }

  console.log(`  Total downloaded: ${downloaded}/${ids.length} images`);
} else {
  console.log('No images to download.');
}

console.log(`Done! Output: ${outDir}`);
