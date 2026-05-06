#!/usr/bin/env node
/**
 * Take a screenshot with selected elements highlighted by numeric labels and boxes.
 *
 * Default mode is actual visibility: outline and numeric labels are applied to the
 * target element itself, so marks are clipped/hidden like the real element. Use
 * this for pass/fail visual evidence.
 *
 * Use --mode layout-rect for diagnostic overlay boxes at getBoundingClientRect()
 * coordinates. This shows the theoretical layout box and is useful after a
 * visibility issue is suspected.
 *
 * Usage:
 *   node scripts/annotate-screenshot.mjs \
 *     --output .verify/panel-annotated.png \
 *     --mark ".panel" \
 *     --mark ".sticky-header" \
 *     [--mode actual|layout-rect] \
 *     [--selector ".crop-container"] \
 *     [--tab <id> | --match <url-pattern>] [--cdp localhost:9222]
 */

import {writeFile} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {openSession, resolveTab, arg} from './cdp.mjs';

function args(name) {
    const results = [];
    const argv = process.argv;
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === `--${name}` && index + 1 < argv.length) {
            results.push(argv[index + 1]);
        }
    }
    return results;
}

const output = arg('output');
const cdpHost = arg('cdp') || 'localhost:9222';
const cropSelector = arg('selector') ?? null;
const mode = arg('mode') ?? 'actual';
const markSelectors = args('mark');

if (!['actual', 'layout-rect'].includes(mode)) {
    console.error('Invalid --mode. Use: actual or layout-rect.');
    process.exit(1);
}

if (!output || markSelectors.length === 0) {
    console.error(
        'Usage: node scripts/annotate-screenshot.mjs --output <path.png> --mark <selector> [--mark <selector> ...] [--mode actual|layout-rect] [--selector <crop-css>] [--tab <id> | --match <url-pattern>] [--cdp localhost:9222]'
    );
    process.exit(1);
}

const COLORS = ['#e02020', '#1a6fe0', '#19a34a', '#8b2be2', '#e07c00'];
const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

const actualInjectExpression = `(function(selectors, colors) {
  const records = [];
  selectors.forEach(function(selector, selectorIndex) {
    const color = colors[selectorIndex % colors.length];
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length === 0) {
      console.warn('[annotate-screenshot] No element found for selector: ' + selector);
      return;
    }
    elements.forEach(function(element, matchIndex) {
      const computed = getComputedStyle(element);
      const original = {
        element: element,
        outline: element.style.getPropertyValue('outline'),
        outlinePriority: element.style.getPropertyPriority('outline'),
        outlineOffset: element.style.getPropertyValue('outline-offset'),
        outlineOffsetPriority: element.style.getPropertyPriority('outline-offset'),
        boxSizing: element.style.getPropertyValue('box-sizing'),
        boxSizingPriority: element.style.getPropertyPriority('box-sizing'),
        position: element.style.getPropertyValue('position'),
        positionPriority: element.style.getPropertyPriority('position')
      };

      element.style.setProperty('outline', '3px solid ' + color, 'important');
      element.style.setProperty('outline-offset', '-2px', 'important');
      element.style.setProperty('box-sizing', 'border-box', 'important');
      if (computed.position === 'static') {
        element.style.setProperty('position', 'relative', 'important');
      }

      const label = document.createElement('span');
      label.setAttribute('data-vv-annotation-label', 'true');
      label.textContent = String(selectorIndex + 1);
      label.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'background:' + color,
        'color:#fff',
        'font:bold 12px/18px monospace',
        'min-width:18px',
        'height:18px',
        'text-align:center',
        'padding:0 4px',
        'border-radius:0 0 3px 0',
        'white-space:nowrap',
        'pointer-events:none',
        'z-index:2147483647'
      ].join(';');
      element.appendChild(label);
      original.label = label;
      records.push(original);
    });
  });
  window.__vv_annotation_records__ = records;
  return records.length;
})(${JSON.stringify(markSelectors)}, ${JSON.stringify(COLORS)})`;

const layoutRectInjectExpression = `(function(selectors, colors) {
  const ids = [];
  selectors.forEach(function(selector, selectorIndex) {
    const color = colors[selectorIndex % colors.length];
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length === 0) {
      console.warn('[annotate-screenshot] No element found for selector: ' + selector);
      return;
    }
    elements.forEach(function(element, matchIndex) {
      const rect = element.getBoundingClientRect();
      const wrapper = document.createElement('div');
      const id = '__vv_annotation_' + selectorIndex + '_' + matchIndex + '__';
      wrapper.id = id;
      wrapper.style.cssText = [
        'position:absolute',
        'left:' + (rect.left + window.pageXOffset) + 'px',
        'top:' + (rect.top + window.pageYOffset) + 'px',
        'width:' + rect.width + 'px',
        'height:' + rect.height + 'px',
        'outline:3px solid ' + color,
        'outline-offset:-2px',
        'pointer-events:none',
        'z-index:2147483647',
        'box-sizing:border-box'
      ].join(';');

      const label = document.createElement('div');
      label.textContent = String(selectorIndex + 1);
      label.style.cssText = [
        'position:absolute',
        'top:-20px',
        'left:-2px',
        'background:' + color,
        'color:#fff',
        'font:bold 12px/20px monospace',
        'padding:0 5px',
        'border-radius:3px 3px 3px 0',
        'white-space:nowrap',
        'pointer-events:none'
      ].join(';');
      wrapper.appendChild(label);
      document.documentElement.appendChild(wrapper);
      ids.push(id);
    });
  });
  window.__vv_annotation_ids__ = ids;
  return ids.length;
})(${JSON.stringify(markSelectors)}, ${JSON.stringify(COLORS)})`;

const injectResult = await cdp.send('Runtime.evaluate', {
    expression: mode === 'actual' ? actualInjectExpression : layoutRectInjectExpression,
    returnByValue: true,
});

if (injectResult.exceptionDetails) {
    console.error(
        'Inject error:',
        injectResult.exceptionDetails.exception?.description ?? injectResult.exceptionDetails.text
    );
    cdp.close();
    process.exit(1);
}

const injectedCount = injectResult.result.value ?? 0;
console.log(`Injected ${injectedCount} annotation(s) for ${markSelectors.length} selector(s) in ${mode} mode`);

let clip = undefined;
if (cropSelector) {
    const cropExpression = `(function(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error('Crop element not found: ' + selector);
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + window.pageXOffset,
      y: rect.top + window.pageYOffset,
      width: rect.width,
      height: rect.height
    };
  })(${JSON.stringify(cropSelector)})`;
    const cropResult = await cdp.send('Runtime.evaluate', {expression: cropExpression, returnByValue: true});
    if (cropResult.exceptionDetails) {
        console.error(
            'Crop selector error:',
            cropResult.exceptionDetails.exception?.description ?? cropResult.exceptionDetails.text
        );
    }
    else {
        clip = {...cropResult.result.value, scale: 1};
        console.log(`Crop rect: x=${clip.x} y=${clip.y} w=${clip.width} h=${clip.height}`);
    }
}

let shot;
try {
    shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? {clip} : {}),
        captureBeyondViewport: true,
    });
}
finally {
    const cleanupExpression = mode === 'actual'
        ? `(function() {
        const records = window.__vv_annotation_records__ || [];
        records.forEach(function(record) {
          if (record.label && record.label.parentNode) record.label.remove();
          if (!record.element) return;
          if (record.outline) record.element.style.setProperty('outline', record.outline, record.outlinePriority);
          else record.element.style.removeProperty('outline');
          if (record.outlineOffset) record.element.style.setProperty('outline-offset', record.outlineOffset, record.outlineOffsetPriority);
          else record.element.style.removeProperty('outline-offset');
          if (record.boxSizing) record.element.style.setProperty('box-sizing', record.boxSizing, record.boxSizingPriority);
          else record.element.style.removeProperty('box-sizing');
          if (record.position) record.element.style.setProperty('position', record.position, record.positionPriority);
          else record.element.style.removeProperty('position');
        });
        delete window.__vv_annotation_records__;
      })()`
        : `(function() {
        const ids = window.__vv_annotation_ids__ || [];
        ids.forEach(function(id) {
          const element = document.getElementById(id);
          if (element) element.remove();
        });
        delete window.__vv_annotation_ids__;
      })()`;
    await cdp.send('Runtime.evaluate', {expression: cleanupExpression}).catch(() => {});
    cdp.close();
}

const outputPath = resolvePath(output);
await writeFile(outputPath, Buffer.from(shot.data, 'base64'));
console.log(`Saved: ${outputPath}`);
