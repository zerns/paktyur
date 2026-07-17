/**
 * placeholderDetector.js — Detect photo placeholder regions in a template.
 *
 * PNG templates: placeholders are fully-transparent regions.
 * JPG templates: placeholders are regions matching a user-picked color.
 *
 * Both use Connected Component Labeling (iterative BFS flood fill, 4-connected)
 * over a boolean mask. Any component touching the image border is treated as
 * background and discarded. Remaining components are validated against size /
 * area limits and sorted top->bottom, then left->right.
 */

const {
  ALPHA_TRANSPARENT_THRESHOLD,
  MIN_PLACEHOLDER_WIDTH,
  MIN_PLACEHOLDER_HEIGHT,
  MIN_PLACEHOLDER_AREA,
  MAX_PLACEHOLDER_WIDTH,
  MAX_PLACEHOLDER_HEIGHT,
  MAX_PLACEHOLDER_AREA,
} = await import('./config.js?v=67fd3f1');
const { nextFrame } = await import('./utils.js?v=d659b1b');

/**
 * Build a boolean mask (Uint8Array, 1 = candidate pixel) from ImageData.
 * @param {ImageData} imageData
 * @param {'png'|'jpg'} mode
 * @param {{color?:[number,number,number], tolerance?:number}} opts
 */
function buildMask(imageData, mode, opts = {}) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);

  if (mode === 'png') {
    for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
      if (data[p] <= ALPHA_TRANSPARENT_THRESHOLD) mask[i] = 1;
    }
  } else {
    const [tr, tg, tb] = opts.color || [0, 0, 0];
    // Compare squared distance to avoid sqrt in the hot loop.
    const tol = opts.tolerance ?? 15;
    const tolSq = tol * tol;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const dr = data[p] - tr;
      const dg = data[p + 1] - tg;
      const db = data[p + 2] - tb;
      if (dr * dr + dg * dg + db * db <= tolSq) mask[i] = 1;
    }
  }
  return mask;
}

/**
 * Connected component labeling via iterative BFS. Uses a preallocated Int32
 * queue (index-based) so there is no recursion and no per-pixel allocation.
 * @returns {Promise<Array<{pixelCount:number,minX:number,minY:number,maxX:number,maxY:number,touchesBorder:boolean}>>}
 */
async function labelComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  const lastRow = height - 1;
  const lastCol = width - 1;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let touchesBorder = false;

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx - x) / width;

      pixelCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === lastCol || y === lastRow) touchesBorder = true;

      // 4-connected neighbours.
      if (x > 0) {
        const n = idx - 1;
        if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
      if (x < lastCol) {
        const n = idx + 1;
        if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
      if (y > 0) {
        const n = idx - width;
        if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
      if (y < lastRow) {
        const n = idx + width;
        if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
    }

    components.push({ pixelCount, minX, minY, maxX, maxY, touchesBorder });

    // Yield periodically so a huge template does not freeze the UI.
    if (components.length % 32 === 0) await nextFrame();
  }
  return components;
}

/** Reason a candidate component was rejected, or null if it passes. */
function rejectionReason(width, height, area) {
  if (width < MIN_PLACEHOLDER_WIDTH) return `Too narrow (${width}px < ${MIN_PLACEHOLDER_WIDTH}px)`;
  if (height < MIN_PLACEHOLDER_HEIGHT) return `Too short (${height}px < ${MIN_PLACEHOLDER_HEIGHT}px)`;
  if (area < MIN_PLACEHOLDER_AREA) return `Area too small (${area}px² < ${MIN_PLACEHOLDER_AREA}px²)`;
  if (width > MAX_PLACEHOLDER_WIDTH) return `Too wide (${width}px > ${MAX_PLACEHOLDER_WIDTH}px)`;
  if (height > MAX_PLACEHOLDER_HEIGHT) return `Too tall (${height}px > ${MAX_PLACEHOLDER_HEIGHT}px)`;
  if (area > MAX_PLACEHOLDER_AREA) return `Area too large (${area}px² > ${MAX_PLACEHOLDER_AREA}px²)`;
  return null;
}

/**
 * Detect placeholders in template ImageData.
 * @param {ImageData} imageData
 * @param {'png'|'jpg'} mode
 * @param {{color?:[number,number,number], tolerance?:number}} [opts]
 * @returns {Promise<{total:number, valid:Array, rejected:Array}>}
 */
export async function detectPlaceholders(imageData, mode, opts = {}) {
  const { width, height } = imageData;
  const mask = buildMask(imageData, mode, opts);
  const components = await labelComponents(mask, width, height);

  const valid = [];
  const rejected = [];
  let id = 0;

  for (const c of components) {
    // Discard background regions connected to the image border.
    if (c.touchesBorder) continue;

    const w = c.maxX - c.minX + 1;
    const h = c.maxY - c.minY + 1;
    const area = w * h;
    const reason = rejectionReason(w, h, area);

    if (reason) {
      rejected.push({ id: id++, reason, width: w, height: h, area });
      continue;
    }

    valid.push({
      id: id++,
      x: c.minX,
      y: c.minY,
      width: w,
      height: h,
      centerX: c.minX + w / 2,
      centerY: c.minY + h / 2,
      area,
      pixelCount: c.pixelCount,
    });
  }

  // Sort top->bottom, then left->right, and renumber sequentially.
  valid.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  valid.forEach((p, i) => {
    p.id = i;
    p.seq = i + 1;
  });

  return { total: valid.length + rejected.length, valid, rejected };
}
