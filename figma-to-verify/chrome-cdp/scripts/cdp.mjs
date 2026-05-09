/**
 * Shared CDP utilities for chrome-cdp skill scripts.
 *
 * Exports:
 *   openSession(tabId, host)       – open CDP WebSocket to a tab
 *   resolveTab(host)               – auto-detect or honour --tab / --match args
 *   navigateAndWait(cdp, url, ms)  – navigate and wait for load event
 *   runScript(cdp, expr)           – evaluate JS, return value (throws on error)
 *   openTab(url, host)             – open a new browser tab via HTTP API
 *   listTabs(host)                 – list all open tabs
 *   arg(name)                      – read --name value from argv
 *   flag(name)                     – check if --name flag is present
 */

import {WebSocket} from 'ws';
import {fileURLToPath} from 'url';
import {join, dirname} from 'path';

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * Open a CDP WebSocket session to a specific tab.
 * Returns { send(method, params), on(event, cb), close() }
 */
export function openSession(tabId, host = 'localhost:9222') {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${host}/devtools/page/${tabId}`);
        let nextId = 0;
        const pending = new Map();
        const listeners = new Map();

        ws.on('open', () =>
            resolve({
                send(method, params = {}) {
                    return new Promise((res, rej) => {
                        const id = ++nextId;
                        pending.set(id, {res, rej});
                        ws.send(JSON.stringify({id, method, params}));
                    });
                },
                on(event, cb) {
                    if (!listeners.has(event)) {
                        listeners.set(event, []);
                    }
                    listeners.get(event).push(cb);
                },
                close() {
                    ws.close();
                },
            }));

        ws.on('message', raw => {
            const msg = JSON.parse(raw);
            if (msg.id && pending.has(msg.id)) {
                const {res, rej} = pending.get(msg.id);
                pending.delete(msg.id);
                msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
            }
            else if (msg.method) {
                (listeners.get(msg.method) || []).forEach(cb => cb(msg.params));
            }
        });

        ws.on('error', reject);
    });
}

// ── Tab resolution ────────────────────────────────────────────────────────────

const CHROME_DEBUG_REF = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'chrome-debug.md');

/**
 * Resolve which tab to connect to.
 *
 * Resolution order:
 *   1. --tab <id>    explicit tab ID
 *   2. --match <url> first page tab whose URL contains the pattern
 *   3. auto          first available page tab
 *
 * If Chrome is unreachable, prints a helpful error and exits.
 */
export async function resolveTab(host = 'localhost:9222') {
    let tabs;
    try {
        const r = await fetch(`http://${host}/json`);
        tabs = await r.json();
    }
    catch {
        console.error(`\nCannot connect to Chrome DevTools at ${host}.`);
        console.error(`Start Chrome with remote debugging enabled, then retry.`);
        console.error(`\nQuick start: google-chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`);
        console.error(`\nFull setup guide: ${CHROME_DEBUG_REF}\n`);
        process.exit(1);
    }

    const pages = tabs.filter(t => t.type === 'page');

    const tabId = arg('tab');
    if (tabId) {
        const found = pages.find(t => t.id === tabId);
        if (!found) {
            console.error(`Tab "${tabId}" not found. Available tabs:`);
            pages.forEach(t => console.error(`  ${t.id}  ${t.url}`));
            process.exit(1);
        }
        return tabId;
    }

    const match = arg('match');
    if (match) {
        const found = pages.find(t => t.url.includes(match));
        if (!found) {
            console.error(`No tab matching "${match}". Available tabs:`);
            pages.forEach(t => console.error(`  ${t.id}  ${t.url}`));
            process.exit(1);
        }
        return found.id;
    }

    if (pages.length === 0) {
        console.error('No page tabs found in Chrome. Open a page first, or see: ' + CHROME_DEBUG_REF);
        process.exit(1);
    }

    const chosen = pages[0];
    console.log(`Using tab: ${chosen.id}  ${chosen.url}`);
    return chosen.id;
}

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * Navigate a tab to a URL and wait for the page load event.
 */
export async function navigateAndWait(cdp, url, timeoutMs = 10000) {
    await cdp.send('Page.enable', {});
    return new Promise(resolve => {
        const timer = setTimeout(resolve, timeoutMs);
        cdp.on('Page.loadEventFired', () => {
            clearTimeout(timer);
            resolve();
        });
        cdp.send('Page.navigate', {url});
    });
}

// ── Script evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a JS expression in the page and return its value.
 * Throws if the expression throws.
 */
export async function runScript(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', {expression, returnByValue: true});
    if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
}

// ── Tab management ────────────────────────────────────────────────────────────

/** Open a new browser tab navigating to url. Returns the tab descriptor. */
export async function openTab(url, host = 'localhost:9222') {
    let tabs;
    try {
        const r = await fetch(`http://${host}/json/new?${encodeURIComponent(url)}`, {method: 'PUT'});
        return r.json();
    }
    catch {
        console.error(`Cannot connect to Chrome at ${host}. See: ${CHROME_DEBUG_REF}`);
        process.exit(1);
    }
}

/** List all open tabs. */
export async function listTabs(host = 'localhost:9222') {
    const r = await fetch(`http://${host}/json`);
    return r.json();
}

// ── CLI helpers ───────────────────────────────────────────────────────────────

/** Read a named CLI arg: --name value → value, or null. */
export function arg(name) {
    const idx = process.argv.indexOf('--' + name);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

/** Check if a flag is present: --name → true. */
export function flag(name) {
    return process.argv.includes('--' + name);
}
