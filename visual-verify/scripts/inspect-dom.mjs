/**
 * Inspect visible interactive elements in the current page.
 * Outputs a JSON array of up to 80 visible elements with their tag, text,
 * aria-label, role, disabled state, class, and bounding rect.
 *
 * Usage:
 *   node inspect-dom.mjs --tab <tabId> [--cdp localhost:9222]
 */

import {openSession, resolveTab, runScript, arg} from './cdp.mjs';

const cdpHost = arg('cdp') || 'localhost:9222';
const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

const raw = await runScript(
    cdp,
    `
JSON.stringify(
  Array.from(document.querySelectorAll('button,a,input,textarea,[role],[aria-label],[class]'))
    .filter(el => el.offsetWidth || el.offsetHeight)
    .slice(0, 80)
    .map(el => ({
      tag:       el.tagName,
      text:      (el.innerText || el.value || '').trim().slice(0, 60),
      ariaLabel: el.getAttribute('aria-label'),
      role:      el.getAttribute('role'),
      disabled:  !!el.disabled,
      className: String(el.className).slice(0, 100),
      rect: {
        width:  Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
      },
    }))
)
`
);

cdp.close();
console.log(JSON.stringify(JSON.parse(raw), null, 2));
