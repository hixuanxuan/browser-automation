/**
 * inject-vet.mjs — inject vet.js into a page tab and export the VET node info.
 *
 * Usage:
 *   node inject-vet.mjs --tab <tabId> --output <info.json>
 *                       [--root <css-selector>]  scope VET to this element
 *                       [--layers <n>]           max nesting layers (default 2)
 *                       [--reload]               reload the page before injecting (default: do NOT reload)
 *                       [--cdp <host:port>]      default: localhost:9222
 *
 * The script:
 *   1. Optionally reloads the page if --reload is passed
 *   2. Optionally sets window.__VET_ROOT__ and window.__VET_MAXLAYERS__
 *   3. Injects vet.js
 *   4. Reads window.__VET_INFO__ and writes it to the output JSON file
 *
 * Output JSON is an array of VET node entries:
 *   [{ color, rect: {x,y,w,h}, category, depth, tag, id, className, text, cssPath }, ...]
 *
 * After this script runs, the tab still has the VET overlay visible — take a screenshot
 * immediately using:
 *   node screenshot.mjs --tab <id> --selector <root-or-body> --output vet.png --no-isolate
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve as resolvePath, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openSession, reloadAndWait, runScript, arg, flag } from './cdp.mjs';

const tabId    = arg('tab');
const outputP  = arg('output');
const rootSel  = arg('root');
const layersN  = arg('layers');
const cdpHost  = arg('cdp') || 'localhost:9222';
const doReload = flag('reload');

if (!tabId || !outputP) {
  console.error('Usage: node inject-vet.mjs --tab <tabId> --output <info.json> [--root <sel>] [--layers <n>] [--reload] [--cdp host:port]');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const vetJs = await readFile(resolvePath(scriptDir, 'vet.js'), 'utf8');

const cdp = await openSession(tabId, cdpHost);

if (doReload) {
  console.log('Reloading tab...');
  await reloadAndWait(cdp);
  console.log('Page loaded.');
}

// Set VET config before injection
if (rootSel) {
  await runScript(cdp, `window.__VET_ROOT__ = ${JSON.stringify(rootSel)};`);
  console.log(`VET root: ${rootSel}`);
}
if (layersN) {
  await runScript(cdp, `window.__VET_MAXLAYERS__ = ${parseInt(layersN, 10)};`);
  console.log(`VET maxLayers: ${layersN}`);
}

// Inject VET
await cdp.send('Runtime.evaluate', { expression: vetJs, returnByValue: true });

// Read VET_INFO
const vetInfo = await runScript(cdp, 'window.__VET_INFO__');
const nodeCount = vetInfo?.length ?? 0;

cdp.close();

// Write output
const outPath = resolvePath(outputP);
await writeFile(outPath, JSON.stringify(vetInfo, null, 2));

console.log(`VET injected: ${nodeCount} nodes`);
console.log(`VET info written to: ${outPath}`);

// Print a colour summary
if (vetInfo) {
  const colorGroups = new Map();
  for (const n of vetInfo) {
    if (!colorGroups.has(n.color)) colorGroups.set(n.color, []);
    colorGroups.get(n.color).push(n);
  }
  console.log('\nColour summary:');
  for (const [color, nodes] of colorGroups) {
    const categories = [...new Set(nodes.map(n => n.category))].join(', ');
    const sizes = nodes.slice(0, 2).map(n => `${Math.round(n.rect.w)}x${Math.round(n.rect.h)}`).join(', ');
    const text = nodes.slice(0, 2).map(n => n.text.slice(0, 20)).filter(Boolean).join(' | ');
    console.log(`  ${color}  ×${nodes.length}  [${categories}]  ${sizes}  "${text}"`);
  }
}
