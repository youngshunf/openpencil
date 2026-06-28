import { describe, it, expect } from 'vitest';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PenDocument } from '@zseven-w/pen-types';
import { renderDocumentToPngBytes } from '@zseven-w/pen-renderer';
import { handleRenderPng } from '../tools/render-png';
import { loadCanvasKitNode, loadBundledFonts, resolveFontDir } from '../render/canvaskit-node';

/** A small but realistic login-card-ish document: frame + brand rect + label text. */
function makeLoginDoc(): PenDocument {
  return {
    version: '0.6.0',
    name: 'Login',
    children: [
      {
        id: 'screen',
        type: 'frame',
        name: 'Screen',
        x: 0,
        y: 0,
        width: 375,
        height: 240,
        fills: [{ type: 'solid', color: '#FFFFFF' }],
        children: [
          {
            id: 'btn',
            type: 'rectangle',
            name: 'LoginButton',
            x: 24,
            y: 160,
            width: 327,
            height: 52,
            cornerRadius: 12,
            fills: [{ type: 'solid', color: '#2563EB' }],
          },
          {
            id: 'title',
            type: 'text',
            name: 'Title',
            x: 24,
            y: 40,
            width: 327,
            height: 40,
            text: '欢迎登录 Welcome',
            fontSize: 28,
            fontFamily: 'Inter',
            fills: [{ type: 'solid', color: '#0F172A' }],
          },
        ],
      },
    ],
  } as unknown as PenDocument;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

describe('renderDocumentToPngBytes (headless)', () => {
  it('renders a document to real PNG bytes at the expected scale', async () => {
    const ck = await loadCanvasKitNode();
    const fonts = await loadBundledFonts(['Inter', 'Noto Sans SC']);

    const result = renderDocumentToPngBytes(makeLoginDoc(), {
      ck,
      scale: 2,
      background: '#FFFFFF',
      fonts,
    });

    expect(result).not.toBeNull();
    expect(isPng(result!.bytes)).toBe(true);
    // 375 x 240 logical content at scale 2 → 750 x 480 px.
    expect(result!.width).toBe(750);
    expect(result!.height).toBe(480);
    expect(result!.bytes.byteLength).toBeGreaterThan(100);
  }, 60_000);

  it('clamps output to maxDimension and supports transparent background', async () => {
    const ck = await loadCanvasKitNode();
    const result = renderDocumentToPngBytes(makeLoginDoc(), {
      ck,
      scale: 100, // would be 37500px wide without clamping
      background: null,
      maxDimension: 1000,
    });
    expect(result).not.toBeNull();
    expect(Math.max(result!.width, result!.height)).toBeLessThanOrEqual(1000);
    expect(isPng(result!.bytes)).toBe(true);
  }, 60_000);

  it('returns null for an empty document', async () => {
    const ck = await loadCanvasKitNode();
    const empty = { version: '0.6.0', children: [] } as unknown as PenDocument;
    expect(renderDocumentToPngBytes(empty, { ck })).toBeNull();
  }, 60_000);
});

describe('handleRenderPng (MCP tool)', () => {
  it('writes a PNG file next to the .op and reports dimensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'penmcp-render-'));
    try {
      const opPath = join(dir, 'login.op');
      await writeFile(opPath, JSON.stringify(makeLoginDoc()), 'utf-8');

      const result = await handleRenderPng({ filePath: opPath, scale: 2 });

      expect(result.ok).toBe(true);
      expect(result.path).toBe(join(dir, 'login.png'));
      expect(result.width).toBe(750);
      expect(result.height).toBe(480);
      expect(result.bytes).toBeGreaterThan(100);

      const written = await readFile(result.path);
      expect(isPng(written)).toBe(true);
      expect(written.byteLength).toBe(result.bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('locates the bundled font directory (vector text available)', async () => {
    // Sanity check that the repo ships the fonts the renderer needs for text.
    const fontDir = await resolveFontDir();
    expect(fontDir).not.toBeNull();
  });
});
