import { useEffect, useRef } from 'react';

import { useDocumentStore } from '@/stores/document-store';
import type { PenDocument } from '@/types/pen';

/**
 * 编辑器挂载时，按 URL `?file=<绝对 .op 路径>` 把对应项目的 `.op` 灌进 document-store。
 *
 * **修「编辑器空白画布」**：唤星独立编辑器窗口此前以 `/editor?project={id}` 打开，但 `/editor` 路由从不消费
 * 该参数、也从不加载项目 `.op` → 永远显示默认空文档（画进 `.op` 的 54 个节点在磁盘上，编辑器却没读）。
 * daemon 现把项目 `.op` 的本机绝对路径作 `&file=` 透传，本 hook 经 sidecar `/api/local-doc` 读盘后
 * `loadDocument` 灌入 store（store 是渲染的唯一真相，灌入即渲染）。
 *
 * - 仅在带 `?file=` 时生效；不带 → no-op（保留落地页/新建空画布既有行为）。
 * - 只跑一次（`loadedRef` 守卫，防 StrictMode 双挂载/重渲染重复加载覆盖用户改动）。
 * - 读盘/解析失败 → 不静默造假：编辑器停在默认空文档并 `console.warn` 说明原因（零 fake）。
 */
export function useProjectFileLoader(): void {
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const file = params.get('file');
    if (!file) return;
    loadedRef.current = true;

    void (async () => {
      try {
        const res = await fetch(`/api/local-doc?file=${encodeURIComponent(file)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          console.warn(`[project-loader] 加载项目 .op 失败：HTTP ${res.status}（编辑器停在空画布）`);
          return;
        }
        const data = (await res.json()) as { document: PenDocument; filePath?: string };
        const fileName = file.split(/[\\/]/).pop() ?? 'design.op';
        useDocumentStore.getState().loadDocument(data.document, fileName, undefined, data.filePath ?? file);
      } catch (err) {
        console.warn('[project-loader] 加载项目 .op 异常（编辑器停在空画布）', err);
      }
    })();
  }, []);
}
