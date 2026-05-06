#!/usr/bin/env node
/**
 * annotate.mjs — DOM-injection annotation via CDP
 *
 * Injects an SVG annotation overlay directly into a live browser tab,
 * takes a cropped screenshot, then removes the overlay.
 *
 * Because the overlay lives in the DOM, the browser handles DPR natively —
 * no image-space coordinate scaling is needed.
 *
 * Usage:
 *   node annotate.mjs \
 *     --cdp    http://localhost:9222      \
 *     --tab    <tabId or wsDebuggerUrl>   \
 *     --output <path/to/output.png>       \
 *     --crop   <padding px>               \
 *     --annotations '[{...}]'
 *
 * Annotation JSON — same schema as before, but coordinates are always in
 * CSS pixels relative to page top-left (getBoundingClientRect + scrollX/scrollY):
 * [
 *   { "rect": { "x": 0, "y": 0, "width": 330, "height": 40 },
 *     "color": "red",           // "red" | "green"
 *     "type": "width",          // "box" | "width" | "height"
 *     "label": "width: 330px"   // string (width/height) or string[] (box)
 *   }
 * ]
 */

import { WebSocket } from 'ws';
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';

const { values } = parseArgs({
  options: {
    cdp:         { type: 'string', default: 'http://localhost:9222' },
    tab:         { type: 'string' },
    output:      { type: 'string' },
    crop:        { type: 'string' },
    annotations: { type: 'string' },
  },
});

if (!values.tab || !values.output || !values.annotations) {
  console.error('Usage: node annotate.mjs --tab <tabId> --output <img> --annotations <json>');
  process.exit(1);
}

const cropPad     = values.crop != null ? parseInt(values.crop, 10) : null;
const annotations = JSON.parse(values.annotations);

// ─── CDP client ───────────────────────────────────────────────────────────────

async function getTabWsUrl(cdpBase, tabIdentifier) {
  if (tabIdentifier.startsWith('ws://') || tabIdentifier.startsWith('wss://')) {
    return tabIdentifier;
  }
  const res  = await fetch(`${cdpBase}/json`);
  const tabs = await res.json();
  const tab  = tabs.find(t => t.id === tabIdentifier);
  if (!tab) throw new Error(`Tab "${tabIdentifier}" not found at ${cdpBase}`);
  return tab.webSocketDebuggerUrl;
}

async function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws      = new WebSocket(wsUrl);
    const pending = new Map();
    let   seq     = 1;

    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = seq++;
      pending.set(id, [res, rej]);
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.on('message', raw => {
      const msg = JSON.parse(String(raw));
      if (!msg.id || !pending.has(msg.id)) return;
      const [res, rej] = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    });

    ws.on('open',  () => resolve({ send, close: () => ws.close() }));
    ws.on('error', reject);
  });
}

async function evalInTab(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new Error(`JS eval error: ${result.exceptionDetails.text}`);
  }
  return result.result?.value;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Visual constants (same values as before, in CSS px) ─────────────────────

const FONT_SIZE   = 13;
const LINE_HEIGHT = 19;
const LABEL_PAD   = 7;
const LABEL_GAP   = 8;
const AVG_CHAR_W  = 7.4;

const DIM_OFFSET  = 10;
const DIM_TICK    = 6;
const DIM_FONT    = 13;
const DIM_CHAR_W  = 7.4;

const PALETTE = {
  red:   { stroke: 'rgba(220,38,38,0.95)', tint: 'rgba(220,38,38,0.12)', labelBg: 'rgba(180,20,20,0.93)', text: '#ffffff' },
  green: { stroke: 'rgba(21,128,61,0.95)', tint: 'rgba(21,128,61,0.12)', labelBg: 'rgba(14,100,47,0.93)', text: '#ffffff' },
};

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function overlapArea(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

function clamp(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }

function estimateLabelBox(lines) {
  const maxChars = Math.max(...lines.map(l => l.length));
  return {
    w: Math.ceil(maxChars * AVG_CHAR_W) + LABEL_PAD * 2,
    h: lines.length * LINE_HEIGHT + LABEL_PAD * 2,
  };
}

function placeLabel(elemRect, lw, lh, placedBoxes, pageW, pageH) {
  const { x, y, w: ew, h: eh } = elemRect;
  const cx = x + ew / 2, cy = y + eh / 2;
  const candidates = [
    { lx: x + ew + LABEL_GAP,  ly: cy - lh / 2 },
    { lx: x - lw - LABEL_GAP,  ly: cy - lh / 2 },
    { lx: cx - lw / 2,          ly: y + eh + LABEL_GAP },
    { lx: cx - lw / 2,          ly: y - lh - LABEL_GAP },
    { lx: x + ew + LABEL_GAP,  ly: y + eh + LABEL_GAP },
    { lx: x - lw - LABEL_GAP,  ly: y + eh + LABEL_GAP },
    { lx: x + ew + LABEL_GAP,  ly: y - lh - LABEL_GAP },
    { lx: x - lw - LABEL_GAP,  ly: y - lh - LABEL_GAP },
  ];
  const obstacles = [...placedBoxes, { x, y, w: ew, h: eh }];
  let best = null, bestScore = Infinity;
  for (const { lx, ly } of candidates) {
    const bx = clamp(lx, 0, pageW - lw);
    const by = clamp(ly, 0, pageH - lh);
    const box = { x: bx, y: by, w: lw, h: lh };
    const score = obstacles.reduce((s, o) => s + overlapArea(box, o), 0)
                + (Math.abs(lx - bx) + Math.abs(ly - by)) * 10;
    if (score < bestScore) { bestScore = score; best = box; }
  }
  return best;
}

// ─── SVG part renderers ───────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderWidthBracket(rx, ry, rw, rh, c, label) {
  const y  = ry + rh + DIM_OFFSET;
  const tw = Math.ceil(label.length * DIM_CHAR_W) + 12;
  const th = DIM_FONT + 8;
  const cx = rx + rw / 2;
  const parts = [
    `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${c.tint}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<line x1="${rx}" y1="${y}" x2="${rx + rw}" y2="${y}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<line x1="${rx}" y1="${y - DIM_TICK}" x2="${rx}" y2="${y + DIM_TICK}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<line x1="${rx + rw}" y1="${y - DIM_TICK}" x2="${rx + rw}" y2="${y + DIM_TICK}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<rect x="${cx - tw / 2}" y="${y - DIM_TICK - th - 2}" width="${tw}" height="${th}" rx="3" fill="${c.labelBg}"/>`,
    `<text x="${cx}" y="${y - DIM_TICK - 6}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="${DIM_FONT}" fill="${c.text}">${esc(label)}</text>`,
  ];
  const contentBox = { x: rx, y: ry, w: rw, h: rh + DIM_OFFSET + DIM_TICK + th + 6 };
  return { parts, contentBox };
}

function renderHeightBracket(rx, ry, rw, rh, c, label) {
  const x  = rx + rw + DIM_OFFSET;
  const tw = Math.ceil(label.length * DIM_CHAR_W) + 12;
  const th = DIM_FONT + 8;
  const cy = ry + rh / 2;
  const parts = [
    `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${c.tint}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<line x1="${x}" y1="${ry}" x2="${x}" y2="${ry + rh}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<line x1="${x - DIM_TICK}" y1="${ry}" x2="${x + DIM_TICK}" y2="${ry}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<line x1="${x - DIM_TICK}" y1="${ry + rh}" x2="${x + DIM_TICK}" y2="${ry + rh}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<rect x="${x + DIM_TICK + 4}" y="${cy - th / 2}" width="${tw}" height="${th}" rx="3" fill="${c.labelBg}"/>`,
    `<text x="${x + DIM_TICK + 10}" y="${cy + DIM_FONT / 2 - 2}" font-family="ui-monospace,Menlo,monospace" font-size="${DIM_FONT}" fill="${c.text}">${esc(label)}</text>`,
  ];
  const contentBox = { x: rx, y: ry, w: rw + DIM_OFFSET + DIM_TICK + tw + 14, h: rh };
  return { parts, contentBox };
}

// ─── Build SVG string ─────────────────────────────────────────────────────────

function buildSvg(annotations, pageW, pageH) {
  const parts       = [];
  const contentBoxes = [];

  for (const ann of annotations) {
    const c    = PALETTE[ann.color] ?? PALETTE.red;
    const { x: rx, y: ry, width: rw, height: rh } = ann.rect;
    const type = ann.type ?? 'box';

    if (type === 'width') {
      const label = typeof ann.label === 'string' ? ann.label : ann.label?.[0] ?? '';
      const { parts: dp, contentBox } = renderWidthBracket(rx, ry, rw, rh, c, label);
      parts.push(...dp);
      contentBoxes.push(contentBox);

    } else if (type === 'height') {
      const label = typeof ann.label === 'string' ? ann.label : ann.label?.[0] ?? '';
      const { parts: dp, contentBox } = renderHeightBracket(rx, ry, rw, rh, c, label);
      parts.push(...dp);
      contentBoxes.push(contentBox);

    } else {
      // box annotation
      if (ann.highlight === 'fill') {
        parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${c.tint}" stroke="${c.stroke}" stroke-width="2"/>`);
      } else {
        parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${c.stroke}" stroke-width="2"/>`);
      }
      contentBoxes.push({ x: rx, y: ry, w: rw, h: rh });

      const labelLines = Array.isArray(ann.label) ? ann.label : (ann.label ? [ann.label] : []);
      if (labelLines.length === 0) continue;

      const { w: lw, h: lh } = estimateLabelBox(labelLines);
      const elemBox           = { x: rx, y: ry, w: rw, h: rh };
      const box               = placeLabel(elemBox, lw, lh, contentBoxes, pageW, pageH);
      contentBoxes.push(box);

      const elCx = rx + rw / 2, elCy = ry + rh / 2;
      const nearX = clamp(elCx, box.x, box.x + box.w);
      const nearY = clamp(elCy, box.y, box.y + box.h);
      parts.push(`<line x1="${elCx}" y1="${elCy}" x2="${nearX}" y2="${nearY}" stroke="${c.stroke}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.75"/>`);
      parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="4" fill="${c.labelBg}"/>`);
      labelLines.forEach((line, i) => {
        parts.push(`<text x="${box.x + LABEL_PAD}" y="${box.y + LABEL_PAD + (i + 1) * LINE_HEIGHT - 4}" font-family="ui-monospace,Menlo,monospace" font-size="${FONT_SIZE}" fill="${c.text}">${esc(line)}</text>`);
      });
    }
  }

  // SVG is positioned at page origin with overflow:visible so it extends as needed
  const svg = [
    `<svg id="__comate_ann__"`,
    `     xmlns="http://www.w3.org/2000/svg"`,
    `     style="position:absolute;top:0;left:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:2147483647;"`,
    `     width="1" height="1">`,
    ...parts,
    `</svg>`,
  ].join('\n');

  return { svg, contentBoxes };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const wsUrl = await getTabWsUrl(values.cdp, values.tab);
const cdp   = await connectCdp(wsUrl);

try {
  // Scroll to top so viewport top = page top
  await evalInTab(cdp, 'window.scrollTo(0, 0)');
  await sleep(300);

  // Get page dimensions
  const pageW = await evalInTab(cdp, 'document.documentElement.scrollWidth');
  const pageH = await evalInTab(cdp, 'document.documentElement.scrollHeight');

  // Build SVG and compute content bounds
  const { svg, contentBoxes } = buildSvg(annotations, pageW, pageH);

  // Ensure body is a positioning context so absolute children position from page origin.
  // Also purge ALL leftover annotation overlays from previous sessions before injecting.
  await evalInTab(cdp, `
    // Remove any element whose ID contains known annotation prefixes
    document.querySelectorAll(
      '[id*="__comate"], [id*="overlay__"], [id*="__issue"], [id*="__ann"]'
    ).forEach(el => el.remove());
    // Restore body positioning if we set it in a previous run
    if (document.body.dataset.__comate_pos_restore__) {
      document.body.style.position = '';
      delete document.body.dataset.__comate_pos_restore__;
    }
    if (getComputedStyle(document.body).position === 'static') {
      document.body.dataset.__comate_pos_restore__ = 'true';
      document.body.style.position = 'relative';
    }
    document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(svg)});
  `);

  // Compute crop rectangle in CSS px
  let clip = undefined;
  if (cropPad != null && contentBoxes.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of contentBoxes) {
      minX = Math.min(minX, b.x);       minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    clip = {
      x:      Math.max(0, minX - cropPad),
      y:      Math.max(0, minY - cropPad),
      width:  Math.min(pageW, maxX - minX + cropPad * 2),
      height: Math.min(pageH, maxY - minY + cropPad * 2),
      scale:  1,    // 1 CSS px → 1 output image pixel (no DPR scaling)
    };
  }

  // Take screenshot via CDP
  const screenshotParams = { format: 'png', captureBeyondViewport: true };
  if (clip) screenshotParams.clip = clip;
  const { data } = await cdp.send('Page.captureScreenshot', screenshotParams);

  // Clean up injected overlay and body positioning
  await evalInTab(cdp, `
    document.getElementById('__comate_ann__')?.remove();
    if (document.body.dataset.__comate_pos_restore__) {
      document.body.style.position = '';
      delete document.body.dataset.__comate_pos_restore__;
    }
  `);

  await fs.writeFile(values.output, Buffer.from(data, 'base64'));
  console.log(`Saved: ${values.output}`);

} finally {
  cdp.close();
}
