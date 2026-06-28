// packages/pen-renderer/src/render-document-headless.ts
//
// Headless full-document renderer: turn a PenDocument into PNG bytes with NO
// browser APIs. Unlike `render-node-thumbnail.ts` (which fits a single node into
// a square and returns a data URL via Blob/FileReader), this renders the whole
// document — or one subtree — at its natural bounds and returns raw PNG bytes.
//
// Design constraints (so it runs under Node / the pen-mcp server):
//   - Caller passes an already-loaded CanvasKit (`ck`). No singleton/SSR magic.
//   - Uses `ck.MakeSurface` (CPU software surface) — no WebGL, no OffscreenCanvas.
//   - Returns `Uint8Array` PNG bytes — no Blob, no FileReader, no data URL.
//   - Fonts are passed in pre-loaded (the browser font loader fetches '/fonts/'
//     over HTTP which does not work headless). Without fonts, shapes still render
//     and text falls back to CanvasKit's default — never throws.

import type { CanvasKit } from 'canvaskit-wasm';
import type { PenDocument, PenNode } from '@zseven-w/pen-types';
import {
  findNodeInTree,
  getAllChildren,
  getDefaultTheme,
  resolveNodeForCanvas,
} from '@zseven-w/pen-core';
import { flattenToRenderNodes, resolveRefs } from './document-flattener.js';
import { SkiaNodeRenderer } from './node-renderer.js';
import { parseColor } from './paint-utils.js';

/** A font typeface pre-read from disk, ready to register into the renderer. */
export interface PreloadedFont {
  /** Family name to register under (see `listBundledFontFiles`). */
  regName: string;
  /** Raw woff2/ttf/otf bytes. */
  data: ArrayBuffer;
}

export interface HeadlessRenderOptions {
  /** An already-initialised CanvasKit instance. */
  ck: CanvasKit;
  /** Output device-pixel scale. Default 2 (retina-quality). */
  scale?: number;
  /** Background fill as hex (`#RRGGBB[AA]`), or `null` for transparent. Default `#FFFFFF`. */
  background?: string | null;
  /** Render only this node subtree (by id). Omit to render the whole page. */
  rootId?: string;
  /** Page id for multi-page docs. Omit to use all top-level children. */
  pageId?: string;
  /** Logical-pixel padding around the content bounds. Default 0. */
  padding?: number;
  /** Clamp the longest *output* edge to this many pixels. Default 4096. */
  maxDimension?: number;
  /** Pre-loaded fonts to register before drawing (for vector text). */
  fonts?: PreloadedFont[];
}

export interface HeadlessRenderResult {
  /** Encoded PNG bytes. */
  bytes: Uint8Array;
  /** Output pixel width. */
  width: number;
  /** Output pixel height. */
  height: number;
  /** Content bounds width in logical (pre-scale) pixels. */
  logicalWidth: number;
  /** Content bounds height in logical (pre-scale) pixels. */
  logicalHeight: number;
  /** The effective scale actually used (may be reduced to respect maxDimension). */
  scale: number;
}

const DEFAULT_SCALE = 2;
const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_BACKGROUND = '#FFFFFF';

/**
 * Render a PenDocument (or one subtree) to PNG bytes, headlessly.
 *
 * Returns `null` (never throws) when there is nothing to render or the surface
 * could not be created. Callers must handle `null`.
 */
export function renderDocumentToPngBytes(
  doc: PenDocument,
  options: HeadlessRenderOptions,
): HeadlessRenderResult | null {
  const { ck } = options;
  if (!ck || !doc) return null;

  // 1. Choose the source nodes (a page's children, the whole doc, or one subtree).
  const pageNodes = selectPageNodes(doc, options.pageId);
  const allNodes = getAllChildren(doc);
  let targets: PenNode[];
  if (options.rootId) {
    const found = findNodeInTree(allNodes, options.rootId);
    if (!found) return null;
    targets = [found];
  } else {
    targets = pageNodes;
  }
  if (targets.length === 0) return null;

  // 2. Resolve `ref` nodes against the full tree (refs can cross pages).
  let resolved: PenNode[];
  try {
    resolved = resolveRefs(targets, allNodes);
  } catch {
    resolved = targets;
  }

  // 3. Resolve `$variable` refs (fill colors, stroke widths, …) to concrete values.
  const variables = doc.variables ?? {};
  const activeTheme = getDefaultTheme(doc.themes);
  const variableResolved = resolved.map((n) => resolveNodeForCanvas(n, variables, activeTheme));

  // 4. Flatten to absolute-positioned render nodes.
  let renderNodes;
  try {
    renderNodes = flattenToRenderNodes(variableResolved);
  } catch {
    return null;
  }
  if (!renderNodes || renderNodes.length === 0) return null;

  // 5. Compute the content bounding box (union of all render-node bounds).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rn of renderNodes) {
    if (rn.absX < minX) minX = rn.absX;
    if (rn.absY < minY) minY = rn.absY;
    if (rn.absX + rn.absW > maxX) maxX = rn.absX + rn.absW;
    if (rn.absY + rn.absH > maxY) maxY = rn.absY + rn.absH;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const padding = Math.max(0, options.padding ?? 0);
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const logicalWidth = Math.max(1, maxX - minX);
  const logicalHeight = Math.max(1, maxY - minY);

  // 6. Determine scale, clamping the longest output edge to maxDimension.
  const requestedScale = options.scale && options.scale > 0 ? options.scale : DEFAULT_SCALE;
  const maxDim = options.maxDimension && options.maxDimension > 0
    ? options.maxDimension
    : DEFAULT_MAX_DIMENSION;
  const longestLogical = Math.max(logicalWidth, logicalHeight);
  const scale = longestLogical * requestedScale > maxDim
    ? maxDim / longestLogical
    : requestedScale;

  const canvasW = Math.max(1, Math.round(logicalWidth * scale));
  const canvasH = Math.max(1, Math.round(logicalHeight * scale));

  // 7. CPU software surface (no WebGL / OffscreenCanvas → headless-safe).
  const surface = ck.MakeSurface(canvasW, canvasH);
  if (!surface) return null;

  const renderer = new SkiaNodeRenderer(ck);
  try {
    // Register pre-loaded fonts so text renders as vector glyphs.
    if (options.fonts) {
      for (const f of options.fonts) {
        renderer.fontManager.registerFont(f.data, f.regName);
      }
    }

    const canvas = surface.getCanvas();
    const background = options.background === undefined ? DEFAULT_BACKGROUND : options.background;
    if (background === null) {
      canvas.clear(ck.TRANSPARENT);
    } else {
      canvas.clear(parseColor(ck, background));
    }

    canvas.scale(scale, scale);
    canvas.translate(-minX, -minY);

    for (const rn of renderNodes) {
      renderer.drawNode(canvas, rn);
    }

    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    if (!snapshot) return null;
    const bytes = snapshot.encodeToBytes();
    if (!bytes) return null;

    return {
      bytes,
      width: canvasW,
      height: canvasH,
      logicalWidth,
      logicalHeight,
      scale,
    };
  } catch {
    return null;
  } finally {
    renderer.dispose();
    surface.delete();
  }
}

/** Resolve the children to render for an optional page id (falls back to all children). */
function selectPageNodes(doc: PenDocument, pageId?: string): PenNode[] {
  if (pageId && Array.isArray(doc.pages)) {
    const page = doc.pages.find((p) => p.id === pageId);
    if (page) return page.children ?? [];
  }
  return getAllChildren(doc);
}
