/**
 * utils.js — Small shared helpers: file validation, feature detection,
 * resource cleanup registry, debounce, and generic DOM utilities.
 */

import { MAX_FILE_BYTES } from './config.js?v=d179be81';

// --- Feature detection ------------------------------------------------------
export const features = {
  offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  createImageBitmap: typeof createImageBitmap === 'function',
  speechRecognition:
    typeof window !== 'undefined' &&
    (typeof window.SpeechRecognition !== 'undefined' ||
      typeof window.webkitSpeechRecognition !== 'undefined'),
  getUserMedia:
    typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
};

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

// --- File validation --------------------------------------------------------
/**
 * Sniff the magic bytes of a file to determine the real image type.
 * Extensions lie; the detection mode (alpha vs color) depends on this.
 * @returns {Promise<'png'|'jpg'|null>}
 */
export async function sniffImageType(file) {
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  // PNG: 89 50 4E 47
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

/**
 * Validate a template file: size + real type. Throws on failure.
 * @returns {Promise<'png'|'jpg'>}
 */
export async function validateTemplateFile(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size === 0) throw new Error('The file is empty or corrupted.');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`);
  }
  const type = await sniffImageType(file);
  if (!type) {
    throw new Error('Unsupported format. Please upload a PNG or JPG/JPEG image.');
  }
  return type;
}

// --- Object URL / resource registry ----------------------------------------
const objectUrls = new Set();

export function trackObjectUrl(url) {
  objectUrls.add(url);
  return url;
}

export function revokeObjectUrl(url) {
  if (url && objectUrls.has(url)) {
    URL.revokeObjectURL(url);
    objectUrls.delete(url);
  }
}

export function revokeAllObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

/** Safely close an ImageBitmap if it exposes close(). */
export function closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') {
    try {
      bitmap.close();
    } catch {
      /* already closed */
    }
  }
}

// --- Timing helpers ---------------------------------------------------------
export function debounce(fn, wait = 150) {
  let t = null;
  const debounced = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
  };
  return debounced;
}

/** Yield to the event loop so long loops don't freeze the UI. */
export function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- DOM helpers ------------------------------------------------------------
export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Register an event listener and return a disposer that removes it.
 * Collect disposers per screen so listeners can be torn down cleanly.
 */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** A simple bag of disposer functions. */
export function createDisposerBag() {
  const disposers = [];
  return {
    add(disposer) {
      if (typeof disposer === 'function') disposers.push(disposer);
      return disposer;
    },
    disposeAll() {
      while (disposers.length) {
        const d = disposers.pop();
        try {
          d();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
