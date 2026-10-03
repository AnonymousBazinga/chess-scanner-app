// Local experimental backend; the server binds only to this computer.
export async function loadRecognizer(onProgress) {
  const response = await fetch('/api/health', { signal: AbortSignal.timeout(10000) });
  if (!response.ok || !(await response.json()).ready) throw new Error('Start the local scanner server and try again.');
  onProgress?.(1);
}

export async function recognize(source, crop) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const c = crop || { x: 0, y: 0, w: width, h: height };
  const scale = Math.min(1, 2048 / Math.max(c.w, c.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(c.w * scale); canvas.height = Math.round(c.h * scale);
  canvas.getContext('2d').drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!image) throw new Error('Could not read this image. Try again.');
  const response = await fetch('/api/recognize', { method: 'POST', body: image, signal: AbortSignal.timeout(120000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Board recognition failed');
  return result.fen;
}
