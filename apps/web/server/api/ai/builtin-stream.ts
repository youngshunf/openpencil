/**
 * Direct streaming completions for the built-in provider path.
 *
 * Replaces the unbuilt `@zseven-w/agent-native` Zig NAPI addon (which is not
 * packaged with the 唤星 design engine) with plain HTTP SSE so the env-backed
 * 唤星 default provider — and BYO openai-compat / anthropic keys — work without
 * any native addon. This is what powers the editor's code export ("代码" tab)
 * and any direct built-in chat.
 *
 * Zero fake: upstream non-2xx responses and in-stream provider errors are
 * thrown so the caller turns them into an explicit SSE `error` event; the
 * frontend never holds the key (it is read from env on the server only).
 */

const DEFAULT_MAX_TOKENS = 16384;
const MAX_ERROR_DETAIL_CHARS = 300;

export interface BuiltinChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BuiltinStreamDelta {
  type: 'text' | 'thinking';
  content: string;
}

interface OpenAIStreamEvent {
  error?: { message?: string };
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string; reasoning?: string };
  }>;
}

interface AnthropicStreamEvent {
  type?: string;
  error?: { message?: string };
  delta?: { type?: string; text?: string; thinking?: string };
}

/**
 * Iterate the `data:` payloads of an SSE response body, trimmed, excluding the
 * terminal `[DONE]` sentinel. Each OpenAI/Anthropic stream event is a single
 * `data:` line, so line-based parsing is sufficient.
 */
async function* iterateSSEData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') return;
        yield data;
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const data = tail.slice(5).trim();
      if (data && data !== '[DONE]') yield data;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** Build a human-readable error from a non-2xx upstream response (unwrap nested error.message). */
async function describeUpstreamError(resp: Response): Promise<string> {
  let detail = '';
  try {
    const text = await resp.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      detail = parsed.error?.message ?? parsed.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* response body unreadable */
  }
  detail = detail.trim();
  if (detail.length > MAX_ERROR_DETAIL_CHARS) {
    detail = `${detail.slice(0, MAX_ERROR_DETAIL_CHARS)}…`;
  }
  return `Upstream LLM error ${resp.status}${detail ? `: ${detail}` : ''}`;
}

export interface OpenAICompatStreamInput {
  apiKey: string;
  /** Root base URL ending at the API version segment (e.g. `https://host/v1`). */
  baseURL: string;
  model: string;
  system: string;
  messages: BuiltinChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Stream an OpenAI-compatible chat completion (`POST {baseURL}/chat/completions`).
 * Covers the env-backed 唤星 default provider (new-api gateway) and BYO
 * openai-compat keys. Emits text deltas plus reasoning deltas (deepseek-style
 * `reasoning_content` / `reasoning`) as thinking.
 */
export async function* streamOpenAICompatCompletion(
  input: OpenAICompatStreamInput,
): AsyncGenerator<BuiltinStreamDelta> {
  const url = `${input.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const payload = {
    model: input.model,
    messages: [
      ...(input.system.trim() ? [{ role: 'system', content: input.system }] : []),
      ...input.messages,
    ],
    stream: true,
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(payload),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!resp.ok) throw new Error(await describeUpstreamError(resp));
  if (!resp.body) throw new Error('Upstream LLM returned no response body');

  for await (const data of iterateSSEData(resp.body)) {
    let evt: OpenAIStreamEvent;
    try {
      evt = JSON.parse(data) as OpenAIStreamEvent;
    } catch {
      continue;
    }
    if (evt.error) {
      throw new Error(`Provider error: ${evt.error.message ?? 'unknown'}`);
    }
    const delta = evt.choices?.[0]?.delta;
    if (!delta) continue;
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      yield { type: 'thinking', content: reasoning };
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      yield { type: 'text', content: delta.content };
    }
  }
}

export interface AnthropicStreamInput {
  apiKey: string;
  /** Root base URL; defaults to the Anthropic public API. */
  baseURL?: string;
  model: string;
  system: string;
  messages: BuiltinChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Stream an Anthropic Messages completion (`POST {baseURL}/v1/messages`) for the
 * BYO anthropic built-in key case. Emits `text_delta` as text and
 * `thinking_delta` as thinking.
 */
export async function* streamAnthropicCompletion(
  input: AnthropicStreamInput,
): AsyncGenerator<BuiltinStreamDelta> {
  const base = (input.baseURL?.replace(/\/+$/, '') ?? '') || 'https://api.anthropic.com';
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const payload = {
    model: input.model,
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(input.system.trim() ? { system: input.system } : {}),
    messages: input.messages,
    stream: true,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!resp.ok) throw new Error(await describeUpstreamError(resp));
  if (!resp.body) throw new Error('Upstream LLM returned no response body');

  for await (const data of iterateSSEData(resp.body)) {
    let evt: AnthropicStreamEvent;
    try {
      evt = JSON.parse(data) as AnthropicStreamEvent;
    } catch {
      continue;
    }
    if (evt.type === 'error') {
      throw new Error(`Provider error: ${evt.error?.message ?? 'unknown'}`);
    }
    if (evt.type === 'content_block_delta') {
      const d = evt.delta;
      if (d?.type === 'text_delta' && typeof d.text === 'string' && d.text.length > 0) {
        yield { type: 'text', content: d.text };
      } else if (
        d?.type === 'thinking_delta' &&
        typeof d.thinking === 'string' &&
        d.thinking.length > 0
      ) {
        yield { type: 'thinking', content: d.thinking };
      }
    }
  }
}
