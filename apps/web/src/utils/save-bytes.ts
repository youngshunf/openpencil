/**
 * Save in-memory bytes to disk, preferring a native "Save As" picker.
 *
 * The plain `<a download>` blob trick silently fails inside a desktop WKWebView
 * (Tauri): clicking the link does nothing — no dialog, no file. This util picks
 * the best available mechanism per runtime:
 *
 * 1. **Tauri desktop** — invoke the host's `save_export_file` command (native
 *    NSSavePanel + `std::fs` write). Cancel → `cancelled`. Command missing
 *    (older host binary) or write failure → fall through to the blob download
 *    so the file is never lost.
 * 2. **Chromium browsers** — `showSaveFilePicker` (File System Access).
 * 3. **Fallback** — same-origin `blob:` + `<a download>` (default downloads dir).
 *
 * Zero fake: the returned `outcome` lets callers report truthfully — `saved`
 * with a path, `cancelled` (never claim success), or `downloaded`.
 */

export interface SaveFilter {
  /** Display name, e.g. "PNG image". */
  name: string;
  /** Extensions without the dot, e.g. ['png']. */
  extensions: string[];
}

export interface SaveBytesResult {
  outcome: 'saved' | 'cancelled' | 'downloaded';
  /** Absolute path on disk — only present for a desktop `saved`. */
  path?: string;
}

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Tauri injects `__TAURI_INTERNALS__.invoke` into authorized webviews regardless of `withGlobalTauri`. */
function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } })
    .__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function' ? internals.invoke : null;
}

/** Last-resort same-origin blob download (works in browsers; ignored by Tauri WKWebView). */
function downloadViaBlob(bytes: Uint8Array, fileName: string, mimeType: string): void {
  // Copy into a plain ArrayBuffer so the Blob doesn't retain WASM-backed memory.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Desktop: native "Save As" via the host command. Throws on missing command / write failure. */
async function saveViaTauri(
  invoke: TauriInvoke,
  bytes: Uint8Array,
  fileName: string,
  filters: SaveFilter[],
): Promise<SaveBytesResult> {
  // Bytes travel as number[] over IPC — export is a one-shot action, not a hot path.
  const path = await invoke<string | null>('save_export_file', {
    defaultName: fileName,
    bytes: Array.from(bytes),
    filters,
  });
  return path ? { outcome: 'saved', path } : { outcome: 'cancelled' };
}

/** Chromium: File System Access native picker + streamed write. */
async function saveViaFilePicker(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  filters: SaveFilter[],
): Promise<SaveBytesResult> {
  const picker = (
    window as unknown as {
      showSaveFilePicker: (opts: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (data: BufferSource) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  try {
    const handle = await picker({
      suggestedName: fileName,
      types: filters.map((f) => ({
        description: f.name,
        accept: { [mimeType]: f.extensions.map((ext) => `.${ext}`) },
      })),
    });
    const writable = await handle.createWritable();
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    await writable.write(copy.buffer as ArrayBuffer);
    await writable.close();
    return { outcome: 'saved' };
  } catch (err) {
    // User cancel = AbortError; report cancelled, never fake success.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { outcome: 'cancelled' };
    }
    throw err;
  }
}

/**
 * Persist `bytes` to disk, surfacing a native "Save As" picker where possible
 * and falling back to a download otherwise.
 */
export async function saveBytesWithPicker(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  filters: SaveFilter[] = [],
): Promise<SaveBytesResult> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      return await saveViaTauri(invoke, bytes, fileName, filters);
    } catch {
      // Command absent (older host) or write failure → blob fallback, never lose the file.
      downloadViaBlob(bytes, fileName, mimeType);
      return { outcome: 'downloaded' };
    }
  }

  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      return await saveViaFilePicker(bytes, fileName, mimeType, filters);
    } catch {
      downloadViaBlob(bytes, fileName, mimeType);
      return { outcome: 'downloaded' };
    }
  }

  downloadViaBlob(bytes, fileName, mimeType);
  return { outcome: 'downloaded' };
}

/** Blob convenience wrapper over {@link saveBytesWithPicker}. */
export async function saveBlobWithPicker(
  blob: Blob,
  fileName: string,
  filters: SaveFilter[] = [],
): Promise<SaveBytesResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return saveBytesWithPicker(bytes, fileName, blob.type || 'application/octet-stream', filters);
}
