import { defineEventHandler, readBody } from 'h3';

/**
 * 方案B（编辑器内置 AI 对话 → 交主人的设计分身在画布上接力出图）。
 *
 * 编辑器直连 sidecar origin 打开（非 daemon 反代同源），内置对话框无法同源调 daemon 业务 API，
 * 也没有 daemon `hasn_session` cookie。改由 **本 sidecar 后端进程** 带 `Bearer <sidecar_token>`
 * 回调 daemon `/api/v1/design/sidecar-dispatch`，daemon 反查 token→owner，自动解析设计分身后派
 * 工作会话，分身用 hasn.design.* 在该项目画布上接力出图（主人重开本项目即可看到分身画的内容）。
 *
 * 运行环境由 hasn-node daemon 注入：
 * - `HUANXING_DAEMON_BASE_URL`：daemon 自身 loopback base URL（如 http://127.0.0.1:56428）。
 * - `OPENPENCIL_SIDECAR_TOKEN`：daemon↔sidecar 共享防护 token（与反代/pen-mcp 同一把）。
 *
 * 二者任一缺失 ⇒ 非唤星宿主环境（独立跑 OpenPencil）⇒ 返回 `{ ok:false, reason:'not_in_huanxing' }`，
 * 前端据此回落到「直连唤星 LLM」的内置对话路径（零降级假象，不伪造成功）。
 *
 * 安全：token 只在本服务进程内读取并作为出站 `Authorization` 头，**绝不**返回浏览器 / 不进响应 /
 * 不进日志（与 huanxing-default.ts 同等密级）。
 */
interface DesignDispatchBody {
  /** 编辑器当前打开的设计项目 id（前端从 URL `?project=` 读取，必带）。 */
  projectId?: string;
  /** 主人在内置对话框说的设计需求。 */
  brief?: string;
}

export default defineEventHandler(async (event) => {
  const base = (process.env.HUANXING_DAEMON_BASE_URL ?? '').trim();
  const token = (process.env.OPENPENCIL_SIDECAR_TOKEN ?? '').trim();
  // 非唤星宿主环境（独立 OpenPencil）→ 诚实告知前端回落直连 LLM。
  if (!base || !token) {
    return { ok: false as const, reason: 'not_in_huanxing' as const };
  }

  const body = await readBody<DesignDispatchBody>(event);
  const projectId = (body?.projectId ?? '').trim();
  const brief = (body?.brief ?? '').trim();
  if (!projectId) {
    return { ok: false as const, reason: 'missing_project' as const };
  }
  if (!brief) {
    return { ok: false as const, reason: 'missing_brief' as const };
  }

  try {
    const res = await fetch(`${base}/api/v1/design/sidecar-dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // sidecar token 仅作出站鉴权头，绝不下发浏览器 / 不进日志。
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ project_id: projectId, brief }),
    });
    if (!res.ok) {
      // daemon 侧错误（如 401 token 失配 / 404 项目不存在）：诚实透出状态，不伪造成功。
      return { ok: false as const, reason: 'daemon_error' as const, status: res.status };
    }
    const data = (await res.json()) as Record<string, unknown>;
    // daemon 返回 { dispatched, session_id, project_id, deep_link, agent_id } 或
    // { dispatched:false, skip_reason }；原样透传给前端（不含任何凭据）。
    return { ok: true as const, result: data };
  } catch {
    // daemon 不可达（未起 / 端口变更）：诚实失败，前端提示稍后再试，不伪造成功。
    return { ok: false as const, reason: 'daemon_unreachable' as const };
  }
});
