/**
 * 唤星 (Huanxing) env-backed built-in provider resolution (server side).
 *
 * The hasn-node daemon injects the current owner's Huanxing LLM credentials into this web
 * process's env (`OPENPENCIL_HUANXING_BASE_URL` / `_API_KEY` / `_MODEL`) so the editor's
 * built-in AI works out of the box. The frontend never holds the key; for env-backed requests
 * it sends `useHuanxingDefault: true` (and an empty apiKey/baseURL) and the server substitutes
 * the env credentials here. Zero fake: when env is missing we throw an explicit error rather
 * than silently degrading.
 */

/** Built-in provider id reserved for the env-backed Huanxing provider. */
export const HUANXING_PROVIDER_ID = 'huanxing';

/** Resolved Huanxing credentials for an outbound OpenAI-compatible request. */
export interface HuanxingDefaultCredentials {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * Whether a request is asking to use the env-backed Huanxing default provider.
 * Accepts either an explicit `useHuanxingDefault` flag or `builtinProviderId === 'huanxing'`.
 */
export function isHuanxingDefaultRequest(input: {
  useHuanxingDefault?: boolean;
  builtinProviderId?: string;
}): boolean {
  return input.useHuanxingDefault === true || input.builtinProviderId === HUANXING_PROVIDER_ID;
}

/**
 * Read the env-injected Huanxing credentials. Returns `null` when not configured
 * (daemon did not inject them — e.g. owner not logged in).
 */
export function readHuanxingDefaultCredentials(): HuanxingDefaultCredentials | null {
  const apiKey = process.env.OPENPENCIL_HUANXING_API_KEY?.trim();
  const baseURL = process.env.OPENPENCIL_HUANXING_BASE_URL?.trim();
  if (!apiKey || !baseURL) return null;
  const model = process.env.OPENPENCIL_HUANXING_MODEL?.trim() ?? '';
  return { apiKey, baseURL, model };
}

/**
 * Resolve Huanxing credentials or throw an explicit error (zero fake). `requestedModel` wins
 * over the env default model when non-empty (the frontend usually sends the env model anyway).
 */
export function requireHuanxingDefaultCredentials(requestedModel?: string): HuanxingDefaultCredentials {
  const creds = readHuanxingDefaultCredentials();
  if (!creds) {
    throw new Error(
      'Huanxing default provider is not configured (missing OPENPENCIL_HUANXING_API_KEY/BASE_URL). ' +
        'Please make sure you are logged in to 唤星.',
    );
  }
  const model = requestedModel?.trim() || creds.model;
  if (!model) {
    throw new Error('Huanxing default provider has no model (set OPENPENCIL_HUANXING_MODEL).');
  }
  return { ...creds, model };
}
