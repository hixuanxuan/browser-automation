/**
 * Inject and execute a script into the page by appending a <script src="..."> tag.
 * Waits for the script to finish loading before exiting.
 *
 * Usage:
 *   node inject.mjs --url <script-url> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 */

import { openSession, resolveTab, arg } from './cdp.mjs';

const scriptUrl = arg('url');
const cdpHost   = arg('cdp') || 'localhost:9222';

if (!scriptUrl) {
  console.error('Usage: node inject.mjs --url <script-url> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]');
  process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp   = await openSession(tabId, cdpHost);

const result = await cdp.send('Runtime.evaluate', {
  expression: `
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ${JSON.stringify(scriptUrl)};
      s.onload  = () => resolve('ok');
      s.onerror = () => reject(new Error('Failed to load script: ' + ${JSON.stringify(scriptUrl)}));
      document.head.appendChild(s);
    })
  `,
  returnByValue: true,
  awaitPromise: true,
});

cdp.close();

if (result.exceptionDetails) {
  console.error('Error:', result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  process.exit(1);
}

console.log(`Injected: ${scriptUrl}`);
