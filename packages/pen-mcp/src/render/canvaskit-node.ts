// packages/pen-mcp/src/render/canvaskit-node.ts
//
// Node-side loading concerns for the headless PNG renderer, kept OUT of
// pen-renderer (which targets the browser and must not import `node:fs`).
//
//   - loadCanvasKitNode(): resolve the canvaskit WASM on disk and init CanvasKit.
//   - resolveFontDir(): locate the bundled woff2 directory (`/fonts`).
//   - loadBundledFonts(): read the woff2 bytes so the renderer can register them.

import { createRequire } from 'node:module';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CanvasKit } from 'canvaskit-wasm';
import { loadCanvasKit, listBundledFontFiles, type PreloadedFont } from '@zseven-w/pen-renderer';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Load (and cache) a CanvasKit instance from the on-disk WASM. Reuses the
 * pen-renderer singleton loader, pointing `locateFile` at the resolved
 * `canvaskit-wasm/bin/*` path so it works headlessly under Node.
 */
export async function loadCanvasKitNode(): Promise<CanvasKit> {
  const wasmPath = require.resolve('canvaskit-wasm/bin/canvaskit.wasm');
  const binDir = dirname(wasmPath);
  return loadCanvasKit({ locateFile: (file: string) => join(binDir, file) });
}

/** Candidate directories that may contain the bundled `/fonts` woff2 files. */
function fontDirCandidates(): string[] {
  const out: string[] = [];
  const env = process.env.OPENPENCIL_FONT_DIR;
  if (env) out.push(env);
  // Repo layout: packages/pen-mcp/src/render → repo root is four levels up.
  const repoRoot = join(HERE, '..', '..', '..', '..');
  out.push(join(repoRoot, 'apps', 'web', 'public', 'fonts'));
  out.push(join(repoRoot, 'out', 'web', 'public', 'fonts'));
  // Process cwd fallbacks (engine bundle / dev server run dir).
  out.push(join(process.cwd(), 'apps', 'web', 'public', 'fonts'));
  out.push(join(process.cwd(), 'out', 'web', 'public', 'fonts'));
  out.push(join(process.cwd(), 'public', 'fonts'));
  return out;
}

/** Find the first candidate font dir that actually contains the core Inter font. */
export async function resolveFontDir(): Promise<string | null> {
  for (const dir of fontDirCandidates()) {
    try {
      await access(join(dir, 'inter-400.woff2'));
      return dir;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Read bundled woff2 fonts from disk, ready to register into the renderer.
 *
 * Returns an empty array (never throws) when the font dir cannot be found — the
 * caller still renders shapes/layout; only vector text would be missing.
 *
 * @param families Optional subset of display names. Omit for the full bundle.
 */
export async function loadBundledFonts(families?: string[]): Promise<PreloadedFont[]> {
  const dir = await resolveFontDir();
  if (!dir) return [];
  const entries = listBundledFontFiles(families);
  const fonts: PreloadedFont[] = [];
  for (const { file, regName } of entries) {
    try {
      const buf = await readFile(join(dir, file));
      // Copy out of the Node Buffer's shared pool into a standalone ArrayBuffer.
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      fonts.push({ regName, data });
    } catch {
      // Skip any missing weight; core fonts still register.
    }
  }
  return fonts;
}
