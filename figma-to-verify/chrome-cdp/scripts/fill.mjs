/**
 * Fill an input element with a value.
 * Sets .value and dispatches input + change events so frameworks (React, Vue, etc.) react.
 *
 * Usage:
 *   node fill.mjs --selector <css> --value <text> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 */

import { openSession, resolveTab, runScript, arg } from './cdp.mjs';

const selector = arg('selector');
const value    = arg('value');
const cdpHost  = arg('cdp') || 'localhost:9222';

if (!selector || value == null) {
  console.error('Usage: node fill.mjs --selector <css> --value <text> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]');
  process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp   = await openSession(tabId, cdpHost);

await runScript(cdp, `
  (function(sel, val) {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Element not found: ' + sel);
    el.focus();
    // Use native setter to bypass React's synthetic event system
    const nativeSetter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })(${JSON.stringify(selector)}, ${JSON.stringify(value)})
`);

console.log(`Filled "${selector}" with: ${value}`);
cdp.close();
