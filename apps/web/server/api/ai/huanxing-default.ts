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
 * display label and default model name. The real key stays in env + this server process.
 */
export default defineEventHandler(() => {
  const available = !!process.env.OPENPENCIL_HUANXING_API_KEY;
  const label = process.env.OPENPENCIL_HUANXING_LABEL ?? '';
  const model = process.env.OPENPENCIL_HUANXING_MODEL ?? '';
  return { available, label, model };
});
