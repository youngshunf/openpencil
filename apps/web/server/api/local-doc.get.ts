import { createError, defineEventHandler, getQuery, getRequestHeader } from 'h3';
import { readFile } from 'node:fs/promises';

/**
 * `GET /api/local-doc?file=<绝对 .op 路径>` —— 读本机磁盘上的项目 `.op` 文件并返回其 PenDocument JSON。
 *
 * 唤星集成专用：独立编辑器窗口直连 sidecar 加载时（`/editor?file=...`），由编辑器客户端 fetch 本路由
 * 把对应项目的 `.op` 灌进 document-store（修「编辑器空白画布」——`?project=` 此前无人消费、文件从不被读）。
 *
 * 与 `local-asset` 同属本机文件读取路由（sidecar 鉴权中间件只拦 `/api/mcp/*`，本路由同源 loopback 放行）。
 * 守卫：拒跨站请求；只接受**绝对路径**且**以 `.op` 结尾**；文件不存在 → 404；非法 JSON → 422。绝不读任意文件、
 * 绝不返回非 `.op` 内容。daemon 端构造的窗口 URL 已把路径限定在 owner 自己的 `design/` 目录内。
 */
export default defineEventHandler(async (event) => {
  const { file } = getQuery(event) as { file?: string };
  const secFetchSite = getRequestHeader(event, 'sec-fetch-site');

  if (secFetchSite === 'cross-site') {
    throw createError({ statusCode: 403, message: 'Cross-site local document requests are blocked' });
  }

  if (!file?.trim()) {
    throw createError({ statusCode: 400, message: 'Missing required query parameter: file' });
  }

  if (file.includes('\0') || !isAbsoluteLocalPath(file) || !file.toLowerCase().endsWith('.op')) {
    throw createError({ statusCode: 400, message: 'Only absolute local .op file paths are supported' });
  }

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw createError({ statusCode: 404, message: 'Design document file not found' });
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw createError({ statusCode: 422, message: 'Design document file is not valid JSON' });
  }

  return { document, filePath: file };
});

function isAbsoluteLocalPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}
