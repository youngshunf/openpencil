import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  streamOpenAICompatCompletion,
  streamAnthropicCompletion,
  type BuiltinStreamDelta,
} from './builtin-stream';

/** Build an SSE Response whose body streams the given raw chunks. */
function sseResponse(chunks: string[], init?: { status?: number }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A non-stream JSON error Response. */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function collect(gen: AsyncGenerator<BuiltinStreamDelta>): Promise<BuiltinStreamDelta[]> {
  const out: BuiltinStreamDelta[] = [];
  for await (const d of gen) out.push(d);
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamOpenAICompatCompletion', () => {
  it('POSTs {baseURL}/chat/completions with a bearer token and yields text + reasoning deltas', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"thinking…"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deltas = await collect(
      streamOpenAICompatCompletion({
        apiKey: 'sk-test',
        baseURL: 'https://gw.example.com/v1',
        model: 'gpt-x',
        system: 'You are a code generator.',
        messages: [{ role: 'user', content: 'make a button' }],
      }),
    );

    expect(deltas).toEqual([
      { type: 'thinking', content: 'thinking…' },
      { type: 'text', content: 'Hello' },
      { type: 'text', content: ' world' },
    ]);

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw.example.com/v1/chat/completions');
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const sentBody = JSON.parse(opts.body as string);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.messages[0]).toEqual({ role: 'system', content: 'You are a code generator.' });
    expect(sentBody.messages[1]).toEqual({ role: 'user', content: 'make a button' });
  });

  it('throws an explicit error (zero fake) on a non-2xx upstream, unwrapping error.message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: { message: 'invalid api key' } })),
    );

    await expect(
      collect(
        streamOpenAICompatCompletion({
          apiKey: 'bad',
          baseURL: 'https://gw.example.com/v1',
          model: 'gpt-x',
          system: '',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(/401.*invalid api key/);
  });

  it('throws on an in-stream provider error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
          'data: {"error":{"message":"content blocked"}}\n\n',
        ]),
      ),
    );

    await expect(
      collect(
        streamOpenAICompatCompletion({
          apiKey: 'sk',
          baseURL: 'https://gw.example.com/v1',
          model: 'gpt-x',
          system: '',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(/Provider error: content blocked/);
  });
});

describe('streamAnthropicCompletion', () => {
  it('POSTs {baseURL}/v1/messages and yields text + thinking deltas', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deltas = await collect(
      streamAnthropicCompletion({
        apiKey: 'sk-ant',
        model: 'claude-x',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(deltas).toEqual([
      { type: 'thinking', content: 'hmm' },
      { type: 'text', content: 'Hi' },
    ]);

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = opts.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});
