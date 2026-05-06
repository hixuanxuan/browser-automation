/**
 * CDP session utilities shared by element-screenshot scripts.
 */

import { WebSocket } from 'ws';

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

    ws.on('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++nextId;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      on(event, cb) {
        if (!eventListeners.has(event)) eventListeners.set(event, []);
        eventListeners.get(event).push(cb);
      },
      close() { ws.close(); },
    }));

    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        (eventListeners.get(msg.method) || []).forEach(cb => cb(msg.params));
      }
    });

    ws.on('error', reject);
  });
}

/** Read a named CLI arg: --name value → value, or null. */
export function arg(name) {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

/** Check if a flag is present: --flag → true. */
export function flag(name) {
  return process.argv.includes('--' + name);
}
