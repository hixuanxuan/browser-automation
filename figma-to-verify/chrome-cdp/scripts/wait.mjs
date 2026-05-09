/**
 * Wait until a CSS selector matches an element in the DOM.
 *
 * Usage:
 *   node wait.mjs --selector <css> [--timeout <ms>] [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 *
 * Default timeout: 10000ms. Polls every 200ms.
 */

import {openSession, resolveTab, arg} from './cdp.mjs';

const selector = arg('selector');
const timeout = parseInt(arg('timeout') || '10000', 10);
const cdpHost = arg('cdp') || 'localhost:9222';

if (!selector) {
    console.error(
        'Usage: node wait.mjs --selector <css> [--timeout <ms>] [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]'
    );
    process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

const deadline = Date.now() + timeout;
const sleep = ms => new Promise(r => setTimeout(r, ms));

while (true) {
    const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
    });
    if (result.result.value) {
        break;
    }
    if (Date.now() >= deadline) {
        console.error(`Timeout: "${selector}" not found within ${timeout}ms`);
        cdp.close();
        process.exit(1);
    }
    await sleep(200);
}

console.log(`Found: ${selector}`);
cdp.close();
