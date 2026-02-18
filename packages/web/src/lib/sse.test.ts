import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSSE } from "./sse";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetch(status: number, chunks: string[]): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    body: makeStream(chunks),
  } as unknown as Response);
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe("parseSSE", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should yield parsed events from a well-formed SSE stream", async () => {
    const fetcher = mockFetch(200, [
      'data: {"a":1}\n\ndata: {"b":2}\n\n',
    ]);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("should handle events split across multiple chunks", async () => {
    const fetcher = mockFetch(200, [
      'data: {"a":',
      '1}\n\n',
    ]);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([{ a: 1 }]);
  });

  it("should skip non-data lines (comments, empty lines)", async () => {
    const fetcher = mockFetch(200, [
      ': this is a comment\n\ndata: {"ok":true}\n\n',
    ]);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([{ ok: true }]);
  });

  it("should skip malformed JSON in data lines", async () => {
    const fetcher = mockFetch(200, [
      'data: not-json\n\ndata: {"ok":true}\n\n',
    ]);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([{ ok: true }]);
  });

  it("should throw on non-2xx response", async () => {
    const fetcher = mockFetch(400, []);

    await expect(
      collect(parseSSE({ url: "/api/test", body: {}, fetcher })),
    ).rejects.toThrow(/400/);
  });

  it("should stop on AbortSignal", async () => {
    const controller = new AbortController();

    // Stream that blocks on the second read until signaled
    let resolveSecond: (() => void) | null = null;
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        async pull(ctrl) {
          if (!resolveSecond) {
            // First chunk — deliver immediately
            ctrl.enqueue(new TextEncoder().encode('data: {"first":true}\n\n'));
            resolveSecond = () => {
              ctrl.enqueue(new TextEncoder().encode('data: {"second":true}\n\n'));
              ctrl.close();
            };
          } else {
            // Second chunk — wait (will never resolve because we abort)
            await new Promise<void>((resolve) => {
              resolveSecond = resolve;
            });
            ctrl.close();
          }
        },
      }),
    } as unknown as Response);

    const events: unknown[] = [];
    try {
      for await (const event of parseSSE({
        url: "/api/test",
        body: {},
        signal: controller.signal,
        fetcher,
      })) {
        events.push(event);
        // Abort after first event
        controller.abort();
      }
    } catch {
      // AbortError is expected
    }

    expect(events).toEqual([{ first: true }]);
  });

  it("should handle empty stream (zero yields)", async () => {
    const fetcher = mockFetch(200, []);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([]);
  });

  it("should handle chunk boundary in middle of double-newline", async () => {
    const fetcher = mockFetch(200, [
      'data: {"a":1}\n',
      '\ndata: {"b":2}\n\n',
    ]);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("should concatenate multiple data: lines in a single SSE message", async () => {
    // Per SSE spec, multiple "data:" lines before a blank line
    // are concatenated with "\n" separators.
    // '{"a":' + '\n' + '1}' = '{"a":\n1}' which is valid JSON (whitespace between tokens)
    const fetcher = mockFetch(200, [
      'data: {"a":\ndata: 1}\n\n',
    ]);

    const events = await collect(
      parseSSE({ url: "/api/test", body: {}, fetcher }),
    );

    expect(events).toEqual([{ a: 1 }]);
  });
});
