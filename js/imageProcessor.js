/**
 * imageProcessor.js — Image decoding, dimension validation, cover-crop,
 * final compositing, and PNG export. Prefers OffscreenCanvas and
 * createImageBitmap where available, and reuses canvases to limit copies.
 */

const { MAX_WIDTH, MAX_HEIGHT } = await import('./config.js?v=a762155');
const { features, closeBitmap, trackObjectUrl } = await import('./utils.js?v=55065fc');

/** Create a 2D drawing surface, preferring OffscreenCanvas. */
export function createCanvas(width, height) {
  if (features.offscreenCanvas) return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Resize an existing canvas in place (reuse to avoid reallocation). */
function sizeCanvas(canvas, width, height) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

/**
 * Decode a File/Blob into an ImageBitmap (async, off main thread when supported).
 * Falls back to an <img> element when createImageBitmap is unavailable.
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
export async function decode(fileOrBlob) {
  if (features.createImageBitmap) {
    try {
      return await createImageBitmap(fileOrBlob);
    } catch (err) {
      throw new Error('The image could not be decoded (it may be corrupted).');
    }
  }
  // Fallback path.
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = trackObjectUrl(URL.createObjectURL(fileOrBlob));
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = url;
  });
}

export function bitmapSize(bitmap) {
  return {
    width: bitmap.width || bitmap.naturalWidth,
    height: bitmap.height || bitmap.naturalHeight,
  };
}

/** Throw if the template exceeds configured limits. */
export function validateDimensions(bitmap) {
  const { width, height } = bitmapSize(bitmap);
  if (!width || !height) throw new Error('The image has no readable dimensions.');
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new Error(
      `Template is too large: ${width}×${height}px. Maximum is ${MAX_WIDTH}×${MAX_HEIGHT}px.`
    );
  }
  return { width, height };
}

/** Draw a bitmap to a canvas and return its ImageData for pixel scanning. */
export function toImageData(bitmap, canvas) {
  const { width, height } = bitmapSize(bitmap);
  const target = canvas ? sizeCanvas(canvas, width, height) : createCanvas(width, height);
  const ctx = target.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Compute source crop rectangle for `object-fit: cover; object-position: center`.
 * Preserves aspect ratio, fills the target, crops overflow, never stretches.
 */
export function coverCropRect(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const cropW = dstW / scale;
  const cropH = dstH / scale;
  const sx = (srcW - cropW) / 2;
  const sy = (srcH - cropH) / 2;
  return { sx, sy, sWidth: cropW, sHeight: cropH };
}

/**
 * Composite captured photos into the template.
 *
 * PNG: photos are drawn first at each placeholder rect, then the template is
 *      drawn on top — its transparent holes reveal the photos beneath.
 * JPG: the template is drawn first, then photos are drawn over each placeholder
 *      rect, covering the colored key regions.
 *
 * @param {ImageBitmap|HTMLImageElement} template
 * @param {'png'|'jpg'} mode
 * @param {Array} placeholders  sorted, valid placeholders
 * @param {Array<ImageBitmap|HTMLImageElement>} photos  indexed to match placeholders
 * @param {HTMLCanvasElement|OffscreenCanvas} [canvas]  reusable output canvas
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function composite(template, mode, placeholders, photos, canvas) {
  const { width, height } = bitmapSize(template);
  const out = canvas ? sizeCanvas(canvas, width, height) : createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const drawPhotos = () => {
    placeholders.forEach((ph, i) => {
      const photo = photos[i];
      if (!photo) return;
      const src = bitmapSize(photo);
      const { sx, sy, sWidth, sHeight } = coverCropRect(src.width, src.height, ph.width, ph.height);
      ctx.drawImage(photo, sx, sy, sWidth, sHeight, ph.x, ph.y, ph.width, ph.height);
    });
  };

  if (mode === 'png') {
    drawPhotos();
    ctx.drawImage(template, 0, 0, width, height);
  } else {
    ctx.drawImage(template, 0, 0, width, height);
    drawPhotos();
  }
  return out;
}

/**
 * Downscale a canvas to `targetW` wide, preserving aspect ratio. Returns the
 * source unchanged if it's already at or below the target width.
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function downscaleCanvas(src, targetW) {
  if (src.width <= targetW) return src;
  const h = Math.round(src.height * (targetW / src.width));
  const out = createCanvas(targetW, h);
  out.getContext('2d').drawImage(src, 0, 0, targetW, h);
  return out;
}

/**
 * Export a canvas to a PNG Blob (async). Works for both canvas types.
 * @returns {Promise<Blob>}
 */
export async function exportPNG(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    // OffscreenCanvas
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to export the composite image.'));
    }, 'image/png');
  });
}

/** Capture a still frame from a <video> into an ImageBitmap. */
export async function frameFromVideo(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('The camera frame is not ready yet.');
  if (features.createImageBitmap) {
    return createImageBitmap(video);
  }
  const canvas = createCanvas(w, h);
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return canvas; // drawable by ctx.drawImage
}

export { closeBitmap };
