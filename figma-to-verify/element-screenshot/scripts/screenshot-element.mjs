/**
 * Take a screenshot of a single DOM element identified by a CSS selector.
 *
 * Modes:
 *  default (isolate):  hide every element that is neither an ancestor nor a
 *                      descendant of the target, then clip to the element rect,
 *                      then restore visibility.  Use for clean "original" screenshots.
 *
 *  --no-isolate:       skip hiding — only clip to the element rect.
 *                      Use AFTER injecting an overlay (e.g. VET) so the overlay
 *                      remains visible in the crop.
 *
 * Usage:
 *   node screenshot-element.mjs \
 *     --tab <tabId> \
 *     --selector <css> \
 *     --output <path.png> \
 *     [--cdp localhost:9222] \
 *     [--no-isolate]
 */

import {writeFile} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {openSession, arg, flag} from './cdp.mjs';

const tabId = arg('tab');
const selector = arg('selector');
const output = arg('output');
const cdpHost = arg('cdp') || 'localhost:9222';
const noIsolate = flag('no-isolate');

if (!tabId || !selector || !output) {
    console.error(
        'Usage: node screenshot-element.mjs --tab <tabId> --selector <css> --output <path.png>'
            + ' [--cdp localhost:9222] [--no-isolate]'
    );
    process.exit(1);
}

const cdp = await openSession(tabId, cdpHost);

// Step 1 – get element rect (and optionally hide off-path elements)
const rectExpr = noIsolate
    // No-isolate: just read the rect
    ? `(function(sel) {
      const el = document.querySelector(sel);
      if (!el) throw new Error('Element not found: ' + sel);
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })(${JSON.stringify(selector)})`
    // Isolate: hide everything outside the target's ancestry, preserve any active overlay
    : `(function(sel) {
      const target = document.querySelector(sel);
      if (!target) throw new Error('Element not found: ' + sel);

      const keep = new Set();
      let cur = target;
      while (cur && cur !== document.documentElement) { keep.add(cur); cur = cur.parentElement; }
      target.querySelectorAll('*').forEach(el => keep.add(el));

      // Preserve any injected overlay (e.g. VET) so it stays visible
      const overlay = document.getElementById('__vet_overlay__');
      if (overlay) { keep.add(overlay); overlay.querySelectorAll('*').forEach(el => keep.add(el)); }

      const saved = [];
      document.querySelectorAll('body *').forEach(el => {
        if (!keep.has(el)) {
          saved.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      });
      window.__element_screenshot_saved__ = saved;

      const r = target.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })(${JSON.stringify(selector)})`;

const evalResult = await cdp.send('Runtime.evaluate', {expression: rectExpr, returnByValue: true});
if (evalResult.exceptionDetails) {
    console.error('Error:', evalResult.exceptionDetails.exception?.description ?? evalResult.exceptionDetails.text);
    cdp.close();
    process.exit(1);
}

const rect = evalResult.result.value;
console.log(`Rect: x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}${noIsolate ? ' (no-isolate)' : ''}`);

// Step 2 – capture screenshot clipped to element bounds
const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: {x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1},
    captureBeyondViewport: true,
});

// Step 3 – restore visibility if isolation was applied
if (!noIsolate) {
    await cdp.send('Runtime.evaluate', {
        expression: `(function() {
      const saved = window.__element_screenshot_saved__;
      if (saved) {
        saved.forEach(([el, val, prio]) => {
          if (val) el.style.setProperty('visibility', val, prio);
          else el.style.removeProperty('visibility');
        });
        delete window.__element_screenshot_saved__;
      }
    })()`,
    });
}

cdp.close();

await writeFile(resolvePath(output), Buffer.from(shot.data, 'base64'));
console.log(`Saved: ${output}`);
