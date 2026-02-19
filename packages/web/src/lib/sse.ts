export interface SSEOptions {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  fetcher?: typeof globalThis.fetch;
}

export async function* parseSSE<T = unknown>(
  options: SSEOptions,
): AsyncGenerator<T, void, undefined> {
  const { url, body, signal, fetcher = globalThis.fetch } = options;

  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE request failed: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("SSE response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Cancel reader when signal fires (ReadableStream doesn't natively respond to AbortSignal)
  let released = false;
  if (signal) {
    signal.addEventListener("abort", () => {
      if (!released) {
        try { reader.cancel(); } catch { /* reader already released */ }
      }
    }, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      // Last element is incomplete — keep it in buffer
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        if (!block.trim()) continue;

        const lines = block.split("\n");
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5));
          }
          // Skip comment lines (starting with ":") and other non-data lines
        }

        if (dataLines.length === 0) continue;

        // Per SSE spec: concatenate multiple data lines with "\n"
        const data = dataLines.join("\n");

        try {
          yield JSON.parse(data) as T;
        } catch {
          // Skip malformed JSON — degrade, don't crash
        }

        if (signal?.aborted) break;
      }
    }

    // Flush any remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split("\n");
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          dataLines.push(line.slice(6));
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5));
        }
      }
      if (dataLines.length > 0) {
        const data = dataLines.join("\n");
        try {
          yield JSON.parse(data) as T;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    released = true;
    reader.releaseLock();
  }
}
