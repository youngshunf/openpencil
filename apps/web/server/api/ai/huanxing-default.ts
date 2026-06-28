import { defineEventHandler } from 'h3';

/**
 * Report whether the host runtime injected a 唤星 (Huanxing) built-in LLM provider
 * so the editor's built-in AI works out of the box without the user pasting an API key.
 *
 * The hasn-node daemon injects `OPENPENCIL_HUANXING_*` into this web process's env when
 * the current owner has Huanxing LLM credentials (per-owner, OpenAI-compatible new-api
 * gateway). The frontend polls this endpoint after store hydration and, when `available`,
 * injects an env-backed built-in provider (id `huanxing`) into its in-memory store.
 *
 * SECURITY: this endpoint NEVER returns the api key or base URL — only a boolean plus a
 * display label, default model name, and the failover model chain. The real key stays in
 * env + this server process.
 *
 * `fallbackModels` is the platform default failover chain: the daemon injects
 * `OPENPENCIL_HUANXING_FALLBACK_MODELS` (comma-joined from the PDC `model_fallback_pool`,
 * primary excluded + deduped). The editor lists the built-in AI model dropdown as
 * [main, ...fallback] so the picker mirrors the agent runtime config (走平台默认配置).
 */
export default defineEventHandler(() => {
  const available = !!process.env.OPENPENCIL_HUANXING_API_KEY;
  const label = process.env.OPENPENCIL_HUANXING_LABEL ?? '';
  const model = process.env.OPENPENCIL_HUANXING_MODEL ?? '';
  const fallbackModels = (process.env.OPENPENCIL_HUANXING_FALLBACK_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return { available, label, model, fallbackModels };
});
