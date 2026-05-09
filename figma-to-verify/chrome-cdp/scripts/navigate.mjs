/**
 * Navigate a tab to a URL and wait for the page to load.
 *
 * Usage:
 *   node navigate.mjs --url <url> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 */

import {openSession, resolveTab, navigateAndWait, arg} from './cdp.mjs';

const url = arg('url');
const cdpHost = arg('cdp') || 'localhost:9222';

if (!url) {
    console.error('Usage: node navigate.mjs --url <url> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]');
    process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

await navigateAndWait(cdp, url);
console.log(`Navigated to: ${url}`);

cdp.close();
