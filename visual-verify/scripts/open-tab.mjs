/**
 * Open a new browser tab and print its ID.
 *
 * Usage:
 *   node open-tab.mjs --url <url> [--cdp localhost:9222]
 *
 * Output:
 *   Prints the tab ID to stdout (one line), suitable for capture.
 */

import {openTab, arg} from './cdp.mjs';

const url = arg('url');
const cdpHost = arg('cdp') || 'localhost:9222';

if (!url) {
  console.error('Usage: node open-tab.mjs --url <url> [--cdp localhost:9222]');
  process.exit(1);
}

const tab = await openTab(url, cdpHost);
console.log(tab.id);
