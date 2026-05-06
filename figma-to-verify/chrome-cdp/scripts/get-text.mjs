/**
 * Get the text content of a DOM element.
 *
 * Usage:
 *   node get-text.mjs --selector <css> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 */

import { openSession, resolveTab, runScript, arg } from './cdp.mjs';

const selector = arg('selector');
const cdpHost  = arg('cdp') || 'localhost:9222';

if (!selector) {
  console.error('Usage: node get-text.mjs --selector <css> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]');
  process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp   = await openSession(tabId, cdpHost);

const text = await runScript(cdp, `
  (function(sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Element not found: ' + sel);
    return el.textContent;
  })(${JSON.stringify(selector)})
`);

console.log(text);
cdp.close();
