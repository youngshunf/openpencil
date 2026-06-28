// packages/pen-mcp/src/tools/render-png.ts
//
// `render_png` MCP tool: rasterize a .op design file to a PNG on disk, headlessly.
//
// This is the headless counterpart to `debug_screenshot` (which needs a live
// Electron/dev canvas). It renders straight from the .op via CanvasKit on a CPU
// surface, so an Agent driving the design tools with no live canvas can still
// produce a real PNG preview/artifact of what it drew.

import { writeFile } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { renderDocumentToPngBytes } from '@zseven-w/pen-renderer';
import { openDocument, resolveDocPath, LIVE_CANVAS_PATH } from '../document-manager';
import { loadCanvasKitNode, loadBundledFonts } from '../render/canvaskit-node';

export interface RenderPngParams {
  /** Path to a `.op` file. Omit to use the default resolved doc path. */
  filePath?: string;
  /** Output PNG path. Omit to write `<doc-stem>.png` next to the source. */
  output?: string;
  /** Render only this node subtree (by id). Omit for the whole document. */
  rootId?: string;
  /** Page id for multi-page docs. Omit for all top-level children. */
  pageId?: string;
  /** Output device-pixel scale (default 2). */
  scale?: number;
  /** Background as hex `#RRGGBB[AA]`, or `"transparent"` for no fill (default `#FFFFFF`). */
  background?: string;
  /** Logical-pixel padding around the content (default 0). */
  padding?: number;
  /** Also return the PNG as base64 in the result (default false; large). */
  returnBase64?: boolean;
}

export interface RenderPngResult {
  ok: true;
  /** Absolute path of the written PNG. */
  path: string;
  /** Output pixel dimensions. */
  width: number;
  height: number;
  /** Content bounds in logical (pre-scale) pixels. */
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
  /** Byte size of the PNG written. */
  bytes: number;
  /** Whether bundled vector fonts were available for text. */
  fontsLoaded: boolean;
  /** Present only when `returnBase64` was requested. */
  base64?: string;
}

const PNG_EXT = /\.op$/i;

/**
 * Render a `.op` document to a PNG file. Throws (with a clear message) on the
 * cases an Agent must hear about: live-canvas-only path, empty/invalid doc, or
 * a surface that could not be created.
 */
export async function handleRenderPng(params: RenderPngParams): Promise<RenderPngResult> {
  const docPath = resolveDocPath(params.filePath);
  if (docPath === LIVE_CANVAS_PATH) {
    throw new Error(
      'render_png renders a .op file headlessly and cannot target the live canvas. ' +
        'Pass filePath to a saved .op, or use debug_screenshot for the live canvas.',
    );
  }

  const doc = await openDocument(docPath);

  const ck = await loadCanvasKitNode();
  const fonts = await loadBundledFonts();

  const background =
    params.background && params.background.toLowerCase() === 'transparent'
      ? null
      : (params.background ?? '#FFFFFF');

  const result = renderDocumentToPngBytes(doc, {
    ck,
    scale: params.scale,
    background,
    rootId: params.rootId,
    pageId: params.pageId,
    padding: params.padding,
    fonts,
  });

  if (!result) {
    throw new Error(
      'Nothing to render: the document has no visible content, or the render surface ' +
        'could not be created. Check that the .op has nodes (and a non-empty rootId if given).',
    );
  }

  const outPath = params.output
    ? resolve(params.output)
    : resolve(join(dirname(docPath), basename(docPath).replace(PNG_EXT, '') + '.png'));

  await writeFile(outPath, result.bytes);

  const out: RenderPngResult = {
    ok: true,
    path: outPath,
    width: result.width,
    height: result.height,
    logicalWidth: result.logicalWidth,
    logicalHeight: result.logicalHeight,
    scale: result.scale,
    bytes: result.bytes.byteLength,
    fontsLoaded: fonts.length > 0,
  };
  if (params.returnBase64) {
    out.base64 = Buffer.from(result.bytes).toString('base64');
  }
  return out;
}
