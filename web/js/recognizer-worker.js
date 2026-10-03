// ChessQ Lite (ViT-S/14, int8 ONNX) board recognition with ONNX Runtime Web.
//
// Input contract, from the model's evaluation transform: plain (non-aspect-preserving)
// resize of the photo to 644x644, RGB in [0, 1], ImageNet mean/std, CHW.
// Output: [1, 64, 13] logits in FEN square order (a8 ... h1), classes ".PNBRQKpnbrqk".
//
// License: the model weights are PolyForm Noncommercial 1.0.0 (Joël Seytre).

// ONNX Runtime Web 1.24.2, served with the site (vendor/ort).
const ORT_BASE = new URL('../vendor/ort/', import.meta.url).href;
// Pinned to the upstream commit that ships this export; same file the app benchmarks.
const MODEL_URL = 'https://huggingface.co/joelseytre/chessqueries/resolve/5d29dfc5b289a31c80018154c797ebe4f0713321/chessquerieslite-vits-644-int8.onnx';
const MODEL_BYTES = 36028599;
const CACHE_NAME = 'chessq-lite-v1';
const SIZE = 644;
const CLASSES = '.PNBRQKpnbrqk';
const MIN_CONFIDENCE = 0.5;

let sessionPromise = null;
let ortModule = null;

/** Starts loading the model (download once, then from cache). */
function loadRecognizer(onProgress) {
  sessionPromise ??= createSession(onProgress).catch((e) => {
    sessionPromise = null;
    throw e;
  });
  return sessionPromise;
}

async function createSession(onProgress) {
  try {
    ortModule ??= await import(/* webpackIgnore: true */ `${ORT_BASE}ort.wasm.min.mjs`);
  } catch {
    throw new Error("Couldn't load the scanner. Check your connection and try again.");
  }
  const ort = ortModule;
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const bytes = await fetchModel(onProgress);
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

async function fetchModel(onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch { /* private mode: no cache */ }
  const cached = await cache?.match(MODEL_URL);
  if (cached) {
    onProgress?.(1);
    return new Uint8Array(await cached.arrayBuffer());
  }
  // Mobile connections drop; retry a couple of times before giving up.
  let bytes = null;
  for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
    try { bytes = await download(onProgress); } catch { bytes = null; }
  }
  if (!bytes) throw new Error("Couldn't download the scanner. Check your connection and try again.");
  try { await cache?.put(MODEL_URL, new Response(bytes)); } catch { /* quota: fine */ }
  return bytes;
}

async function download(onProgress) {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || MODEL_BYTES;
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, received);
    received += value.length;
    onProgress?.(Math.min(1, received / total));
  }
  if (received < total) throw new Error('Incomplete download');
  return out;
}

function decode(logits) {
  const n = CLASSES.length;
  if (logits.length !== 64 * n) throw new Error('Board recognition failed');
  const board = [];
  let confidence = 0;
  for (let sq = 0; sq < 64; sq++) {
    const row = logits.subarray(sq * n, sq * n + n);
    const max = Math.max(...row);
    let total = 0, best = 0, bestExp = 0;
    for (let k = 0; k < n; k++) {
      const e = Math.exp(row[k] - max);
      total += e;
      if (e > bestExp) { bestExp = e; best = k; }
    }
    confidence += bestExp / total;
    board.push(CLASSES[best]);
  }
  if (confidence / 64 < MIN_CONFIDENCE) {
    throw new Error("Couldn't find a chessboard. Try again with the whole board in view.");
  }
  const ranks = [];
  for (let r = 0; r < 8; r++) {
    let row = '', empty = 0;
    for (const c of board.slice(r * 8, r * 8 + 8)) {
      if (c === '.') { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += c;
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  return `${ranks.join('/')} w - - 0 1`;
}

// Inference stays off the UI thread so the scan feedback can keep moving.
self.onmessage = async ({ data: { id, type, input } }) => {
  try {
    const session = await loadRecognizer((progress) => self.postMessage({ progress }));
    if (type === 'load') {
      self.postMessage({ id, result: true });
      return;
    }
    const feeds = { [session.inputNames[0]]: new ortModule.Tensor('float32', input, [1, 3, SIZE, SIZE]) };
    const results = await session.run(feeds);
    self.postMessage({ id, result: decode(results[session.outputNames[0]].data) });
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Board recognition failed' });
  }
};
