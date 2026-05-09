/**
 * screenshot.mjs — capture a page or element screenshot via CDP.
 *
 * Usage:
 *   node screenshot.mjs --tab <tabId> --output <path.png>
 *                       [--selector <css>]   clip to element bounds
 *                       [--no-isolate]       skip hiding off-path elements (useful when overlay is present)
 *                       [--cdp <host:port>]  default: localhost:9222
 *
 * Default mode (with selector, no --no-isolate):
 *   Hides every element that is neither an ancestor nor a descendant of the target,
 *   except #__vet_overlay__ which is always preserved.
 *   Then clips the screenshot to the element rect.  Restores visibility after.
 *   Use this to take clean "original" screenshots of a specific element.
 *
 * --no-isolate mode (requires --selector):
 *   Only clips to the element rect — no hiding.
 *   Use this AFTER injecting an overlay so the overlay stays visible in the crop.
 *
 * No selector:
 *   Takes a full-page screenshot (captureBeyondViewport: true).
 */

import {writeFile} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {openSession, arg, flag} from './cdp.mjs';

const tabId = arg('tab');
const selector = arg('selector');
const output = arg('output');
const cdpHost = arg('cdp') || 'localhost:9222';
const noIsolate = flag('no-isolate');

if (!tabId || !output) {
    console.error(
        'Usage: node screenshot.mjs --tab <tabId> --output <path.png> [--selector <css>] [--cdp host:port] [--no-isolate]'
    );
    process.exit(1);
}

const cdp = await openSession(tabId, cdpHost);

let clip = null;

if (selector) {
    const isolateExpr = noIsolate
        // No-isolate: just read the rect
        ? `(function(sel) {
        const el = document.querySelector(sel);
        if (!el) throw new Error('Element not found: ' + sel);
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      })(${JSON.stringify(selector)})`
        // Isolate: hide off-path elements, read rect
        : `(function(sel) {
        const target = document.querySelector(sel);
        if (!target) throw new Error('Element not found: ' + sel);

        const keep = new Set();
        let cur = target;
        while (cur && cur !== document.documentElement) { keep.add(cur); cur = cur.parentElement; }
        target.querySelectorAll('*').forEach(el => keep.add(el));

        // Always keep the VET overlay so it stays visible
        const overlay = document.getElementById('__vet_overlay__');
        if (overlay) { keep.add(overlay); overlay.querySelectorAll('*').forEach(el => keep.add(el)); }

        const saved = [];
        document.querySelectorAll('body *').forEach(el => {
          if (!keep.has(el)) {
            saved.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
            el.style.setProperty('visibility', 'hidden', 'important');
          }
        });
        window.__screenshot_saved__ = saved;

        const r = target.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      })(${JSON.stringify(selector)})`;

    const evalResult = await cdp.send('Runtime.evaluate', {expression: isolateExpr, returnByValue: true});
    if (evalResult.exceptionDetails) {
        console.error('Error:', evalResult.exceptionDetails.exception?.description ?? evalResult.exceptionDetails.text);
        cdp.close();
        process.exit(1);
    }
    const rect = evalResult.result.value;
    console.log(`Rect: x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}${noIsolate ? ' (no-isolate)' : ''}`);
    clip = {x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1};
}

const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    ...(clip ? {clip} : {}),
});

// Restore visibility if isolation was applied
if (selector && !noIsolate) {
    await cdp.send('Runtime.evaluate', {
        expression: `(function() {
      const saved = window.__screenshot_saved__;
      if (saved) {
        saved.forEach(([el, val, prio]) => {
          if (val) el.style.setProperty('visibility', val, prio);
          else el.style.removeProperty('visibility');
        });
        delete window.__screenshot_saved__;
      }
    })()`,
    });
}

cdp.close();

const outPath = resolvePath(output);
await writeFile(outPath, Buffer.from(shot.data, 'base64'));
console.log(`Saved: ${outPath}`);
