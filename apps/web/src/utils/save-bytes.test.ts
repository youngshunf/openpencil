// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveBytesWithPicker, saveBlobWithPicker } from './save-bytes';

interface WinShim {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  showSaveFilePicker?: unknown;
}

const win = window as unknown as WinShim;

let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete win.__TAURI_INTERNALS__;
  delete win.showSaveFilePicker;
  // jsdom has no Object URL impl — stub so the blob fallback doesn't throw.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:stub');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  clickSpy.mockRestore();
  vi.restoreAllMocks();
});

const bytes = new Uint8Array([1, 2, 3, 4]);

describe('saveBytesWithPicker', () => {
  it('uses the Tauri host command and reports saved with the returned path', async () => {
    const invoke = vi.fn().mockResolvedValue('/Users/me/Downloads/poster.png');
    win.__TAURI_INTERNALS__ = { invoke };

    const result = await saveBytesWithPicker(bytes, 'poster.png', 'image/png', [
      { name: 'PNG 图片', extensions: ['png'] },
    ]);

    expect(result).toEqual({ outcome: 'saved', path: '/Users/me/Downloads/poster.png' });
    expect(invoke).toHaveBeenCalledWith('save_export_file', {
      defaultName: 'poster.png',
      bytes: [1, 2, 3, 4], // travels as number[] over IPC
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('reports cancelled when the host save dialog returns null', async () => {
    win.__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue(null) };
    const result = await saveBytesWithPicker(bytes, 'poster.png', 'image/png');
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('falls back to a blob download when the host command is missing/throws', async () => {
    win.__TAURI_INTERNALS__ = { invoke: vi.fn().mockRejectedValue(new Error('command not found')) };
    const result = await saveBytesWithPicker(bytes, 'poster.png', 'image/png');
    expect(result).toEqual({ outcome: 'downloaded' });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to a blob download in a plain browser with no picker', async () => {
    const result = await saveBytesWithPicker(bytes, 'poster.png', 'image/png');
    expect(result).toEqual({ outcome: 'downloaded' });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the File System Access picker when available (no Tauri)', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    win.showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    });

    const result = await saveBytesWithPicker(bytes, 'poster.png', 'image/png');
    expect(result).toEqual({ outcome: 'saved' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('reports cancelled when the user aborts the File System Access picker', async () => {
    win.showSaveFilePicker = vi.fn().mockRejectedValue(
      new DOMException('The user aborted a request.', 'AbortError'),
    );
    const result = await saveBytesWithPicker(bytes, 'poster.png', 'image/png');
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe('saveBlobWithPicker', () => {
  it('unwraps the blob to bytes and routes through the host command', async () => {
    const invoke = vi.fn().mockResolvedValue('/tmp/design.pdf');
    win.__TAURI_INTERNALS__ = { invoke };
    // jsdom's Blob lacks arrayBuffer(); supply a minimal shim (real browsers/WKWebView have it).
    const raw = new Uint8Array([9, 8, 7]);
    const blob = {
      type: 'application/pdf',
      arrayBuffer: () => Promise.resolve(raw.buffer),
    } as unknown as Blob;

    const result = await saveBlobWithPicker(blob, 'design.pdf', [
      { name: 'PDF', extensions: ['pdf'] },
    ]);

    expect(result).toEqual({ outcome: 'saved', path: '/tmp/design.pdf' });
    expect(invoke).toHaveBeenCalledWith('save_export_file', {
      defaultName: 'design.pdf',
      bytes: [9, 8, 7],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });
});
