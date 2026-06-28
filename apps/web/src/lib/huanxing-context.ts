/**
 * 唤星宿主上下文判定。
 *
 * 编辑器经唤星 daemon 打开某个设计项目时，URL 必带 `?project=<id>`（与
 * ai-chat-handlers 的派发回调、sidecar 协作派发口径一致）。此时画布上往往
 * 已有设计内容，空态应引导「在现有设计上协作改图」、对话直接派给主人的
 * 视觉设计分身。
 *
 * 独立 OpenPencil 打开文件不带此 query → 返回空/false，保留上游原有的
 * 「从零新建设计」默认体验，互不影响。
 */
export function huanxingProjectId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const id = new URLSearchParams(window.location.search).get('project')?.trim();
  return id ? id : null;
}

/** 是否处于唤星编辑器语境（带 `?project=`）。 */
export function isHuanxingProjectContext(): boolean {
  return huanxingProjectId() !== null;
}
