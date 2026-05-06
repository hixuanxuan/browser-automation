/**
 * Take a screenshot of a single element identified by a CSS selector.
 *
 * Modes:
 *  default (isolate):   hide every element that is neither an ancestor nor a descendant of the
 *                       target, then clip to the element rect, then restore visibility.
 *                       Use for plain "original" screenshots.
 *
 *  --no-isolate:        skip hiding — only clip to the element rect.
 *                       Use AFTER injecting vet.js, so the overlay remains visible in the crop.
 *
 * Usage:
 *   node screenshot-element.mjs --tab <tabId> --selector <css> --output <path> [--cdp localhost:9222] [--no-isolate]
 */

import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { WebSocket } from 'ws';

function arg(name) {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}
function flag(name) {
  return process.argv.includes('--' + name);
}

const tabId     = arg('tab');
const selector  = arg('selector');
const output    = arg('output');
const cdpHost   = arg('cdp') || 'localhost:9222';
const noIsolate = flag('no-isolate');

if (!tabId || !selector || !output) {
  console.error('Usage: node screenshot-element.mjs --tab <tabId> --selector <css> --output <path> [--cdp localhost:9222] [--no-isolate]');
  process.exit(1);
}

// ── CDP helper ────────────────────────────────────────────────────────────────
function openSession(tabId, host) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}/devtools/page/${tabId}`);
    let nextId = 0;
    const pending = new Map();

    ws.on('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); },
      });
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });

    ws.on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const session = await openSession(tabId, cdpHost);

// Step 1 – get rect (and optionally isolate)
const expr = noIsolate
  ? `
(function (sel) {
  const target = document.querySelector(sel);
  if (!target) throw new Error('Element not found: ' + sel);
  const r = target.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
})(${JSON.stringify(selector)})
`
  : `
(function (sel) {
  const target = document.querySelector(sel);
  if (!target) throw new Error('Element not found: ' + sel);

  const keep = new Set();
  let cur = target;
  while (cur && cur !== document.documentElement) { keep.add(cur); cur = cur.parentElement; }
  target.querySelectorAll('*').forEach(el => keep.add(el));

  // Also keep VET overlay (if present) so it remains visible in the screenshot
  const vetOverlay = document.getElementById('__vet_overlay__');
  if (vetOverlay) {
    keep.add(vetOverlay);
    vetOverlay.querySelectorAll('*').forEach(el => keep.add(el));
  }

  const saved = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!keep.has(el)) {
      saved.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  });
  window.__screenshot_element_saved__ = saved;

  const r = target.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
})(${JSON.stringify(selector)})
`;

const evalResult = await session.send('Runtime.evaluate', { expression: expr, returnByValue: true });

if (evalResult.exceptionDetails) {
  console.error('Error:', evalResult.exceptionDetails.exception?.description ?? evalResult.exceptionDetails.text);
  session.close();
  process.exit(1);
}

const rect = evalResult.result.value;
console.log(`Rect: x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}${noIsolate ? ' (no-isolate mode)' : ''}`);

// Step 2 – screenshot with clip
const shot = await session.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  captureBeyondViewport: true,
});

// Step 3 – restore visibility (isolate mode only)
if (!noIsolate) {
  await session.send('Runtime.evaluate', {
    expression: `
      (function () {
        const saved = window.__screenshot_element_saved__;
        if (!saved) return;
        saved.forEach(([el, val, prio]) => {
          if (val) el.style.setProperty('visibility', val, prio);
          else el.style.removeProperty('visibility');
        });
        delete window.__screenshot_element_saved__;
      })()
    `,
  });
}

session.close();

await writeFile(resolve(output), Buffer.from(shot.data, 'base64'));
console.log(`Saved: ${output}`);
