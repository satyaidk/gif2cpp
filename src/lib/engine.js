// Promise wrapper around the worker.
const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });

let seq = 0;
const pending = new Map();
const progressListeners = new Set();

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') {
    progressListeners.forEach((fn) => fn(m));
    return;
  }
  const p = pending.get(m.reqId);
  if (!p) return;
  pending.delete(m.reqId);
  if (m.failed) p.reject(new Error(m.failed));
  else p.resolve(m);
};

function call(type, payload) {
  const reqId = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    worker.postMessage({ type, reqId, ...payload });
  });
}

export const engine = {
  load: (id, files, sequence = false) => call('load', { id, files, sequence }),
  /** Resolves with the result, or { stale: true } if a newer request replaced it. */
  process: (id, settings) => call('process', { id, settings }),
  source: (id, index, settings) => call('source', { id, index, settings }),
  drop: (id) => worker.postMessage({ type: 'drop', id }),
  onProgress(fn) {
    progressListeners.add(fn);
    return () => progressListeners.delete(fn);
  },
};
