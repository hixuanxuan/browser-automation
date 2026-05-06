/**
 * inject-overlay.mjs — inject a custom semantic colour overlay into a page.
 *
 * Usage:
 *   node inject-overlay.mjs --tab <tabId> --config <mapping.json>
 *                           [--cdp <host:port>]   default: localhost:9222
 *
 * Config file format (JSON):
 *   {
 *     "blocks": [
 *       { "selector": ".root-container", "color": "#2196F3" },
 *       { "selector": ".card-item",      "color": "#9C27B0", "all": true },
 *       { "selector": ".search-input",   "color": "#9C27B0" },
 *       { "selector": ".sort-group",     "color": "#9C27B0" },
 *       { "selector": "span.tab-active", "color": "#FFD600" }
 *     ]
 *   }
 *
 * Each entry:
 *   selector  CSS selector to find the element(s)
 *   color     hex colour to paint on this element
 *   all       if true, use querySelectorAll (paint all matching); default: false (querySelector, first match only)
 *
 * The overlay uses position:absolute and paints blocks at the elements' document coordinates.
 * Any existing overlay with id "__vet_overlay__" is removed first.
 *
 * After injection, take a screenshot:
 *   node screenshot.mjs --tab <id> --selector <root> --output vet-dev.png --no-isolate
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import { openSession, runScript, arg } from './cdp.mjs';

const tabId    = arg('tab');
const configP  = arg('config');
const cdpHost  = arg('cdp') || 'localhost:9222';

if (!tabId || !configP) {
  console.error('Usage: node inject-overlay.mjs --tab <tabId> --config <mapping.json> [--cdp host:port]');
  process.exit(1);
}

const config = JSON.parse(await readFile(resolvePath(configP), 'utf8'));
const blocks = config.blocks;

if (!Array.isArray(blocks) || blocks.length === 0) {
  console.error('Config must have a non-empty "blocks" array.');
  process.exit(1);
}

const cdp = await openSession(tabId, cdpHost);

// Inject the overlay via CDP
const injectExpr = `
(function(blocks) {
  const OVERLAY_ID = '__vet_overlay__';
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:absolute;left:0;top:0;width:' + docW + 'px;height:' + docH + 'px;' +
    'z-index:2147483646;pointer-events:none;';

  let added = 0;

  function paintEl(el, color) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const div = document.createElement('div');
    div.style.cssText =
      'position:absolute;' +
      'left:' + (r.left + window.scrollX) + 'px;' +
      'top:' + (r.top  + window.scrollY) + 'px;' +
      'width:'  + r.width  + 'px;' +
      'height:' + r.height + 'px;' +
      'border-radius:2px;box-sizing:border-box;background:' + color + ';';
    overlay.appendChild(div);
    added++;
  }

  const results = [];
  for (const block of blocks) {
    const { selector, color, all } = block;
    if (all) {
      const els = document.querySelectorAll(selector);
      els.forEach(el => paintEl(el, color));
      results.push({ selector, color, count: els.length });
    } else {
      const el = document.querySelector(selector);
      if (el) { paintEl(el, color); results.push({ selector, color, count: 1 }); }
      else results.push({ selector, color, count: 0, notFound: true });
    }
  }

  document.body.appendChild(overlay);
  return { added, results };
})(${JSON.stringify(blocks)})
`;

const result = await runScript(cdp, injectExpr);
cdp.close();

console.log(`Overlay injected: ${result.added} blocks`);
for (const r of result.results) {
  if (r.notFound) console.warn(`  WARNING: selector not found — "${r.selector}"`);
  else console.log(`  ${r.color}  ×${r.count}  "${r.selector}"`);
}
