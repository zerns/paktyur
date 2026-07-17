#!/usr/bin/env node
/**
 * stamp-versions.mjs — Content-hash cache-busting stamper.
 *
 * Rewrites every `<file>?v=<hash>` reference so a file's version token equals a
 * short hash of that file's current contents. A file's `?v=` therefore changes
 * only when the file itself changes, so browsers refetch only what actually
 * changed and keep everything else cached.
 *
 * Versioned targets: every js/*.js + styles.css.
 * Referencing files (where `?v=` tokens live): those same js files + index.html.
 *
 * Because stamping a leaf (e.g. config.js) alters its importers' contents — and
 * thus their hashes — we re-stamp to a fixpoint so changes propagate all the way
 * up to index.html.
 *
 * Also derives sw.js CACHE_NAME from the final index.html hash so the service
 * worker cache turns over whenever anything changes.
 *
 * No dependencies. Run from anywhere: `node scripts/stamp-versions.mjs`.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'js');

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 7);

// Versioned targets keyed by basename (basenames are unique across the project).
const targets = [
  ...readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => join('js', f)),
  'styles.css',
];
// Files that contain `?v=` references to rewrite.
const refFiles = [
  'index.html',
  ...readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => join('js', f)),
];

// In-memory contents; we mutate then flush once at the end.
const contents = new Map();
for (const rel of new Set([...targets, ...refFiles, 'sw.js'])) {
  contents.set(rel, readFileSync(join(root, rel), 'utf8'));
}

// Escape a basename for use in a RegExp.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One stamping pass: set every `<basename>?v=...` to the target's current hash.
// Returns true if anything changed this pass.
function stampPass() {
  let changed = false;

  // Compute current hashes of all targets from their (possibly updated) contents.
  const version = new Map();
  for (const rel of targets) version.set(basename(rel), hash(contents.get(rel)));

  for (const rel of refFiles) {
    let text = contents.get(rel);
    for (const [name, h] of version) {
      // Match: an optional path prefix, the basename, `?v=`, then old hash chars.
      const re = new RegExp(`(${esc(name)}\\?v=)[0-9a-f]+`, 'g');
      text = text.replace(re, `$1${h}`);
    }
    if (text !== contents.get(rel)) {
      contents.set(rel, text);
      changed = true;
    }
  }
  return changed;
}

// Iterate to a fixpoint — a leaf change bubbles up through importers.
const MAX_PASSES = 10;
let passes = 0;
while (stampPass()) {
  if (++passes >= MAX_PASSES) {
    console.error(`stamp-versions: did not converge after ${MAX_PASSES} passes`);
    process.exit(1);
  }
}

// Derive service-worker cache name from the final index.html contents.
const swRel = 'sw.js';
let sw = contents.get(swRel);
const cacheName = `paktyur-cache-${hash(contents.get('index.html'))}`;
sw = sw.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = '${cacheName}';`);
contents.set(swRel, sw);

// Flush only files whose contents actually changed on disk.
const changedFiles = [];
for (const rel of contents.keys()) {
  const onDisk = readFileSync(join(root, rel), 'utf8');
  if (onDisk !== contents.get(rel)) {
    writeFileSync(join(root, rel), contents.get(rel));
    changedFiles.push(rel);
  }
}

if (changedFiles.length) {
  console.log('stamp-versions: updated\n  ' + changedFiles.sort().join('\n  '));
} else {
  console.log('stamp-versions: no changes (already up to date)');
}
