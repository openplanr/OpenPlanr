/**
 * Minimal SSE test client for the board daemon's GET /api/feedback/stream.
 * Pure stdlib (node:http streaming get + a hand-rolled `event:`/`data:` frame parser) so the
 * live-collaboration tests can stay focused on feedback intent rather than transport.
 */

import { get as httpGet } from 'node:http';

/**
 * Open a streaming SSE connection to the board and collect parsed { event, data } frames.
 * Returns a handle exposing the live event list, a waitFor(predicate) promise helper, and close().
 */
export function openSse(base, id, identity = {}) {
  const qs = new URLSearchParams(identity).toString();
  const url = `${base}/boards/${encodeURIComponent(id)}/api/feedback/stream${qs ? `?${qs}` : ''}`;
  const events = [];
  const waiters = [];
  let buffer = '';

  const flushWaiters = () => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const w = waiters[i];
      const hit = events.find(w.predicate);
      if (hit) {
        waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(hit);
      }
    }
  };

  let req;
  const ready = new Promise((resolveReady, rejectReady) => {
    req = httpGet(url, (res) => {
      if (res.statusCode !== 200) {
        rejectReady(new Error(`stream status ${res.statusCode}`));
        res.resume();
        return;
      }
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        buffer += chunk;
        // SSE frames are separated by a blank line.
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let eventName = 'message';
          let dataLines = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue; // comment frame (e.g. the open ping)
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length) {
            let data;
            try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
            events.push({ event: eventName, data });
            flushWaiters();
          }
        }
      });
      resolveReady();
    });
    req.on('error', rejectReady);
  });

  return {
    ready,
    events,
    waitFor(predicate, { timeout = 4000, label = 'event' } = {}) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`timed out waiting for ${label}`));
        }, timeout);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
    close() {
      try { req.destroy(); } catch { /* already closed */ }
    },
  };
}

/** Predicate factory: matches a collected frame by its event name. */
export const isEvent = (name) => (e) => e.event === name;
