#!/usr/bin/env node

import {parseArgs} from 'node:util';
import {mkdir, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';

const F2C_HOST = 'https://f2c-figma-api.yy.com/api';
const FIGMA_IMAGE_HOST_PATTERN = /https:\/\/figma-alpha-api\.s3\.us-west-2\.amazonaws\.com\/images\/[a-f0-9-]+/g;

const {values} = parseArgs({
  options: {
    'figma-url': {type: 'string'},
    token: {type: 'string'},
    username: {type: 'string'},
    scale: {type: 'string', default: '1'},
    output: {type: 'string', default: '.'},
  },
});

const figmaUrl = values['figma-url'];
const token = values.token;
const output = values.output;
const scale = Number(values.scale || '1');

if (!figmaUrl || !token) {
  console.error('Usage: convert-node.mjs --figma-url <url> --token <figma_token> [--username <name>] [--output <dir>]');
  console.error('  figma-url: Full Figma URL, e.g. https://www.figma.com/design/XXXX/Name?node-id=123-456');
  console.error('  token:     Figma personal access token');
  console.error('  username:  Reserved for backward compatibility; ignored by the local converter');
  console.error('  output:    Output directory (default: current dir)');
  process.exit(1);
}

if (!Number.isFinite(scale) || scale < 1 || scale > 4) {
  console.error('scale must be a number between 1 and 4');
  process.exit(1);
}

function parseFigmaUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const designIndex = parts.indexOf('design') === -1 ? parts.indexOf('file') : parts.indexOf('design');

  if (designIndex === -1 || !parts[designIndex + 1]) {
    throw new Error(`Cannot parse file key from URL: ${url}`);
  }

  const fileKey = parts[designIndex + 1];
  const nodeId = parsed.searchParams.get('node-id');

  if (!nodeId) {
    throw new Error('URL must contain a node-id parameter');
  }

  return {fileKey, nodeId};
}

function toApiNodeId(nodeId) {
  return nodeId.replace(/-/g, ':');
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value == null) {
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        url.searchParams.append(`${key}[${nestedKey}]`, String(nestedValue));
      }
      continue;
    }

    url.searchParams.append(key, String(value));
  }

  return url.toString();
}

function sanitizePathSegment(name) {
  return String(name || 'output').replace(/[\/\\:*?"<>|]/g, '_');
}

function wrapHtmlContent(content) {
  const normalized = content.toLowerCase();
  if (normalized.includes('<!doctype html') || normalized.includes('<html')) {
    return content;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>F2C Generated</title>
  <style>html, body { margin: 0; padding: 0; }</style>
</head>
<body>
${content}
</body>
</html>`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status} ${response.statusText}) for ${url}${text ? `: ${text}` : ''}`);
  }

  return response.json();
}

async function resolveNodeInfo(fileKey, apiNodeId, fallbackName) {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(apiNodeId)}`;
  const data = await fetchJson(url, {
    headers: {'X-Figma-Token': token},
  });

  const node = data.nodes?.[apiNodeId]?.document;
  return {
    name: node?.name || fallbackName,
    width: node?.absoluteBoundingBox?.width ?? null,
    height: node?.absoluteBoundingBox?.height ?? null,
  };
}

async function convertNode(fileKey, apiNodeId) {
  const url = buildUrl(`${F2C_HOST}/nodes`, {
    fileKey,
    nodeIds: apiNodeId,
    personal_token: token,
    option: {
      cssFramework: 'inlinecss',
      imgFormat: 'png',
      scaleSize: scale,
    },
    format: 'files',
  });

  const data = await fetchJson(url, {
    headers: {
      'F2c-Api-Platform': 'comate-script',
    },
  });

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('F2C returned no files');
  }

  return data;
}

async function downloadImagesAndReplaceContent(content, assetsDir) {
  const matches = content.match(FIGMA_IMAGE_HOST_PATTERN);
  if (!matches) {
    return {content, downloaded: 0};
  }

  const replacements = new Map();

  for (const remoteUrl of [...new Set(matches)]) {
    const fileName = `${basename(remoteUrl)}.png`;
    const localRelativePath = `assets/${fileName}`;
    const destination = join(assetsDir, fileName);
    const response = await fetch(remoteUrl);

    if (!response.ok) {
      throw new Error(`Failed to download image ${remoteUrl}: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, buffer);
    replacements.set(remoteUrl, localRelativePath);
  }

  let processedContent = content;
  for (const [remoteUrl, localPath] of replacements.entries()) {
    processedContent = processedContent.replaceAll(remoteUrl, localPath);
  }

  return {content: processedContent, downloaded: replacements.size};
}

const {fileKey, nodeId} = parseFigmaUrl(figmaUrl);
const apiNodeId = toApiNodeId(nodeId);

console.log('Converting Figma node to HTML with local F2C client...');

const files = await convertNode(fileKey, apiNodeId);
const nodeInfo = await resolveNodeInfo(fileKey, apiNodeId, nodeId).catch(() => ({name: nodeId, width: null, height: null}));
const nodeName = sanitizePathSegment(nodeInfo.name);
const outDir = join(output, nodeName);
const assetsDir = join(outDir, 'assets');

await mkdir(outDir, {recursive: true});
await mkdir(assetsDir, {recursive: true});

let totalDownloaded = 0;

for (const file of files) {
  const filePath = join(outDir, file.path);
  await mkdir(dirname(filePath), {recursive: true});

  let content = file.content;
  const {content: localizedContent, downloaded} = await downloadImagesAndReplaceContent(content, assetsDir);
  totalDownloaded += downloaded;
  content = localizedContent;

  if (file.path.endsWith('.html')) {
    content = wrapHtmlContent(content);
  }

  await writeFile(filePath, content, 'utf-8');
  console.log(`  Written: ${filePath}`);
}

console.log(`  Total downloaded: ${totalDownloaded} images`);

// Write viewport metadata derived from Figma node dimensions
if (nodeInfo.width != null && nodeInfo.height != null) {
  const viewport = {
    width: Math.round(nodeInfo.width),
    height: Math.round(nodeInfo.height),
    mobile: nodeInfo.width <= 480,
  };
  await writeFile(join(outDir, 'viewport.json'), JSON.stringify(viewport, null, 2));
  console.log(`  Viewport: ${viewport.width}x${viewport.height}${viewport.mobile ? ' (mobile)' : ''}`);
}

console.log(`Done! Output: ${outDir}`);
