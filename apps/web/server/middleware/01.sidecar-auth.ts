// 唤星本地 sidecar 加固：web app `/api/mcp/*`（live-canvas 桥）受 sidecar token 保护。
//
// - 配了 OPENPENCIL_SIDECAR_TOKEN（daemon 生产注入两进程 env）→ 强制校验 `Authorization: Bearer <token>`。
// - 裸跑不配（本地 dev / P0 spike）→ 放行，保持开发友好。
//
// 信任链：浏览器（独立编辑器窗口）经 daemon 反代访问 `/api/v1/design/ui/api/mcp/*`，
// daemon 反代在转发时附加 Bearer（浏览器 EventSource 无法自带 header，由 daemon 注入）；
// pen-mcp → web 调用经 document-manager.authFetch 附加同一 token。
// 故只有 daemon 反代 / pen-mcp 能到达本路由，任意本机网页无法直接驱动画布。
const SIDECAR_TOKEN = process.env.OPENPENCIL_SIDECAR_TOKEN;

export default defineEventHandler((event) => {
  if (!SIDECAR_TOKEN) return;
  const path = getRequestURL(event).pathname;
  if (!path.startsWith('/api/mcp/')) return;
  const auth = getRequestHeader(event, 'authorization');
  if (auth !== `Bearer ${SIDECAR_TOKEN}`) {
    setResponseStatus(event, 401);
    return { error: 'unauthorized: missing or invalid sidecar token' };
  }
});
