/**
 * Take a screenshot of the page or a specific element.
 *
 * Modes:
 *  no --selector:      full-page screenshot (captureBeyondViewport)
 *  --selector:         clip to element bounds; hide surrounding elements (isolate mode)
 *  --selector + --no-isolate:  clip only, preserve overlays and surrounding content
 *
 * Usage:
 *   node screenshot.mjs --output <path.png> [--selector <css>] [--no-isolate]
 *                        [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 */

import {writeFile} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {openSession, resolveTab, arg, flag} from './cdp.mjs';

const selector = arg('selector');
const output = arg('output');
const cdpHost = arg('cdp') || 'localhost:9222';
const noIsolate = flag('no-isolate');

if (!output) {
    console.error(
        'Usage: node screenshot.mjs --output <path.png> [--selector <css>] [--no-isolate] [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]'
    );
    process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

let clip = null;

if (selector) {
    // Determine element rect, optionally hiding off-path elements
    const rectExpr = noIsolate
        ? `(function(sel) {
        const el = document.querySelector(sel);
        if (!el) throw new Error('Element not found: ' + sel);
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      })(${JSON.stringify(selector)})`
        : `(function(sel) {
        const target = document.querySelector(sel);
        if (!target) throw new Error('Element not found: ' + sel);

        const keep = new Set();
        let cur = target;
        while (cur && cur !== document.documentElement) { keep.add(cur); cur = cur.parentElement; }
        target.querySelectorAll('*').forEach(el => keep.add(el));

        // Preserve any injected overlay (e.g. VET)
        const overlay = document.getElementById('__vet_overlay__');
        if (overlay) { keep.add(overlay); overlay.querySelectorAll('*').forEach(el => keep.add(el)); }

        const saved = [];
        document.querySelectorAll('body *').forEach(el => {
          if (!keep.has(el)) {
            saved.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
            el.style.setProperty('visibility', 'hidden', 'important');
          }
        });
        window.__cdp_screenshot_saved__ = saved;

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
    console.log(
        `Element rect: x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}${noIsolate ? ' (no-isolate)' : ''}`
    );
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
      const saved = window.__cdp_screenshot_saved__;
      if (saved) {
        saved.forEach(([el, val, prio]) => {
          if (val) el.style.setProperty('visibility', val, prio);
          else el.style.removeProperty('visibility');
        });
        delete window.__cdp_screenshot_saved__;
      }
    })()`,
    });
}

cdp.close();

const outPath = resolvePath(output);
await writeFile(outPath, Buffer.from(shot.data, 'base64'));
console.log(`Saved: ${outPath}`);
