/**
 * CDP session utilities.
 *
 * Usage:
 *   import { openSession, reloadAndWait, runScript, openTab, listTabs } from './cdp.mjs';
 */

import {WebSocket} from 'ws';

// ── Session ──────────────────────────────────────────────────────────────────

/**
 * Open a CDP WebSocket session to a tab.
 * Returns { send(method, params), on(event, cb), close() }
 */
export function openSession(tabId, host = 'localhost:9222') {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${host}/devtools/page/${tabId}`);
        let nextId = 0;
        const pending = new Map();
        const eventListeners = new Map();

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
                    if (!eventListeners.has(event)) {
                        eventListeners.set(event, []);
                    }
                    eventListeners.get(event).push(cb);
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
                (eventListeners.get(msg.method) || []).forEach(cb => cb(msg.params));
            }
        });

        ws.on('error', reject);
    });
}

// ── Navigation ───────────────────────────────────────────────────────────────

/**
 * Reload the tab and wait for Page.loadEventFired.
 * Falls back to polling document.readyState if the event is slow.
 */
export async function reloadAndWait(cdp, timeoutMs = 8000) {
    await cdp.send('Page.enable', {});
    return new Promise(resolve => {
        const timer = setTimeout(async () => {
            // Fallback: check readyState directly
            const r = await cdp.send('Runtime.evaluate', {
                expression: 'document.readyState',
                returnByValue: true,
            });
            resolve(); // resolve regardless — let caller decide if they need more waiting
        }, timeoutMs);
        cdp.on('Page.loadEventFired', () => {
            clearTimeout(timer);
            resolve();
        });
        cdp.send('Page.reload', {});
    });
}

// ── Script evaluation ────────────────────────────────────────────────────────

/**
 * Evaluate a JavaScript expression in the page and return its value.
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

/** Open a new tab navigating to url. Returns the tab descriptor ({ id, ... }). */
export async function openTab(url, host = 'localhost:9222') {
    const r = await fetch(`http://${host}/json/new?${encodeURIComponent(url)}`, {method: 'PUT'});
    return r.json();
}

/** List all open tabs. */
export async function listTabs(host = 'localhost:9222') {
    const r = await fetch(`http://${host}/json`);
    return r.json();
}

// ── Argument parsing helpers ──────────────────────────────────────────────────

/** Read a named CLI arg: --name value → value, or null. */
export function arg(name) {
    const idx = process.argv.indexOf('--' + name);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

/** Check if a flag is present: --flag → true. */
export function flag(name) {
    return process.argv.includes('--' + name);
}
