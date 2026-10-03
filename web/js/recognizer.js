// Vercel uses the structured API; the static demo uses a browser worker.
const SIZE = 644;
// Keep the original local experiment servers available for comparisons.
const localHybrid = ['localhost', '127.0.0.1'].includes(location.hostname)
  && ['hybrid', 'structured'].includes(new URLSearchParams(location.search).get('scanner'));
// GitHub Pages remains a static, browser-only demo; Vercel uses the new service.
export const usesServer = !location.hostname.endsWith('.github.io');
let worker;
let ready;
let latestProgress = null;
let nextId = 0;
const pending = new Map();
const listeners = new Set();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./recognizer-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.progress != null) {
      latestProgress = data.progress;
      for (const listener of listeners) listener(data.progress);
      return;
    }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    for (const request of pending.values()) request.reject(new Error("Couldn't start the scanner. Please try again."));
    pending.clear();
    worker.terminate();
    worker = null;
    ready = null;
    latestProgress = null;
  };
  return worker;
}

function request(type, input) {
  return new Promise((resolve, reject) => {
    const target = getWorker();
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    try {
      target.postMessage({ id, type, input }, input ? [input.buffer] : []);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

/** Subscribers also get progress from a preload that is already in flight. */
export async function loadRecognizer(onProgress) {
  if (localHybrid) return (await import('./recognizer-local.js')).loadRecognizer(onProgress);
  if (usesServer) return (await import('./recognizer-server.js')).loadRecognizer(onProgress);
  if (onProgress) {
    listeners.add(onProgress);
    if (latestProgress != null) onProgress(latestProgress);
  }
  try {
    ready ??= request('load').catch((error) => {
      ready = null;
      latestProgress = null;
      throw error;
    });
    await ready;
  } finally {
    if (onProgress) listeners.delete(onProgress);
  }
}

export async function recognize(source, crop) {
  if (localHybrid) return (await import('./recognizer-local.js')).recognize(source, crop);
  if (usesServer) return (await import('./recognizer-server.js')).recognize(source, crop);
  await loadRecognizer();
  return request('recognize', preprocess(source, crop));
}

function preprocess(source, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const c = crop || { x: 0, y: 0, w, h };
  ctx.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < plane; i++) {
    for (let ch = 0; ch < 3; ch++) out[ch * plane + i] = (data[i * 4 + ch] / 255 - mean[ch]) / std[ch];
  }
  return out;
}
