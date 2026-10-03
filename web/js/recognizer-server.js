// Same-origin server inference. The photo is processed in memory and not stored.
export async function loadRecognizer(onProgress) {
  onProgress?.(1);
}

export async function recognize(source, crop) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const c = crop || { x: 0, y: 0, w: width, h: height };
  const scale = Math.min(1, 2048 / Math.max(c.w, c.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(c.w * scale));
  canvas.height = Math.max(1, Math.round(c.h * scale));
  canvas.getContext('2d').drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
  let image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (image?.size > 4000000) image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
  if (!image || image.size > 4000000) throw new Error('Please choose a smaller photo.');
  let response;
  try {
    response = await fetch('/api/recognize', {
      method: 'POST', body: image, signal: AbortSignal.timeout(300000),
    });
  } catch {
    throw new Error('Could not reach the scanner. Check your connection and try again.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The scanner could not finish. Please try again.');
  if (typeof result.fen !== 'string' || result.fen.split(' ')[0].split('/').length !== 8) {
    throw new Error('The scanner returned an unreadable board. Please try again.');
  }
  return result;
}
