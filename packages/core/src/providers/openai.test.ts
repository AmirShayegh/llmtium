import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderConfig, StructuredRequest } from "./types.js";

// --- Mock setup ---

class MockAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
class MockRateLimitError extends MockAPIError {
  constructor() { super(429, "Rate limited"); }
}
class MockAPIConnectionError extends Error {
  override name = "APIConnectionError";
  constructor() { super("Connection refused"); }
}

const mockCreate = vi.fn();
const mockModelsList = vi.fn();

vi.mock("./transient-retry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./transient-retry.js")>();
  return {
    ...mod,
    withTransientRetry: <T>(fn: () => Promise<T>, maxRetries?: number, baseDelayMs?: number) =>
      mod.withTransientRetry(fn, maxRetries, baseDelayMs, () => Promise.resolve()),
  };
});

vi.mock("openai", () => {
  const OpenAI = vi.fn(() => ({
    chat: { completions: { create: mockCreate } },
    models: { list: mockModelsList },
  }));
  return {
    default: Object.assign(OpenAI, {
      APIError: MockAPIError,
      RateLimitError: MockRateLimitError,
      APIConnectionError: MockAPIConnectionError,
    }),
  };
});

// --- Helpers ---

function makeStreamChunks(
  texts: string[],
  usage: { prompt_tokens: number; completion_tokens: number },
) {
  const chunks = texts.map((text) => ({
    choices: [{ delta: { content: text } }],
  }));
  // Final chunk with usage
  chunks.push({ choices: [{ delta: {} }], usage } as Record<string, unknown>);
  return {
    [Symbol.asyncIterator]: async function* () { yield* chunks; },
  };
}

function makeJsonResponse(data: Record<string, unknown>) {
  return {
    choices: [{ message: { content: JSON.stringify(data) } }],
  };
}

const config: ProviderConfig = { apiKey: "sk-test-key" };
const structuredReq: StructuredRequest = {
  userPrompt: "Review these responses",
  systemPrompt: "You are a reviewer",
  schema: { type: "object", properties: { score: { type: "number" } } },
  toolName: "submit_review",
  toolDescription: "Submit your review",
};

// --- Tests ---

describe("openaiProvider", () => {
  let provider: typeof import("./openai.js");

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await import("./openai.js");
  });

  describe("meta", () => {
    it("should have correct id, name, and defaultModel", () => {
      expect(provider.openaiProvider.meta.id).toBe("openai");
      expect(provider.openaiProvider.meta.name).toBe("OpenAI");
      expect(provider.openaiProvider.meta.defaultModel).toBe("gpt-5.2");
    });
  });

  describe("draft", () => {
    it("should collect streamed delta.content chunks", async () => {
      mockCreate.mockResolvedValue(
        makeStreamChunks(["Hello", " world"], { prompt_tokens: 8, completion_tokens: 4 }),
      );

      const result = await provider.openaiProvider.draft(config, {
        userPrompt: "Say hello",
        systemPrompt: "Be friendly",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("Hello world");
        expect(result.data.tokensIn).toBe(8);
        expect(result.data.tokensOut).toBe(4);
        expect(result.data.model).toBe("gpt-5.2");
        expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should use config.model when provided", async () => {
      mockCreate.mockResolvedValue(
        makeStreamChunks(["Hi"], { prompt_tokens: 3, completion_tokens: 1 }),
      );

      await provider.openaiProvider.draft(
        { apiKey: "key", model: "gpt-4o-mini" },
        { userPrompt: "test" },
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-4o-mini" }),
      );
    });

    it("should return error on authentication failure", async () => {
      mockCreate.mockRejectedValue(new MockAPIError(401, "Unauthorized"));

      const result = await provider.openaiProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });

    it("should return error on network failure", async () => {
      mockCreate.mockRejectedValue(new MockAPIConnectionError());

      const result = await provider.openaiProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Connection failed");
    });
  });

  describe("structuredOutput", () => {
    it("should parse JSON from response_format json_schema response", async () => {
      mockCreate.mockResolvedValue(makeJsonResponse({ score: 4.5 }));

      const result = await provider.openaiProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(4.5);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({
            type: "json_schema",
            json_schema: expect.objectContaining({ name: "submit_review" }),
          }),
        }),
      );
    });

    it("should return error when content is null", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: null } }] });

      const result = await provider.openaiProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Structured output failed");
    });

    it("should retry on invalid JSON and succeed", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }] })
        .mockResolvedValueOnce(makeJsonResponse({ score: 3 }));

      const result = await provider.openaiProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(3);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should return error after 3 consecutive parse failures", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: "bad" } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: "still bad" } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: "very bad" } }] });

      const result = await provider.openaiProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Structured output failed after 3 attempts");
    });

    it("should fail immediately on non-transient API error without retrying", async () => {
      mockCreate.mockRejectedValueOnce(new MockAPIError(400, "Bad request"));

      const result = await provider.openaiProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("API error (400)");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("should retry on 503 transient error and succeed", async () => {
      const error503 = new MockAPIError(503, "Service unavailable");
      mockCreate
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(makeJsonResponse({ score: 4 }));

      const result = await provider.openaiProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(4);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe("transient retry", () => {
    it("should retry on 503 in draft and succeed", async () => {
      const error503 = new MockAPIError(503, "Service unavailable");
      mockCreate
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(
          makeStreamChunks(["recovered"], { prompt_tokens: 5, completion_tokens: 3 }),
        );

      const result = await provider.openaiProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("recovered");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should exhaust retries on persistent 503 in draft", async () => {
      const error503 = new MockAPIError(503, "Service unavailable");
      mockCreate.mockRejectedValue(error503);

      const result = await provider.openaiProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("API error (503): Service unavailable");
      expect(mockCreate).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });

    it("should retry connection error in draft", async () => {
      mockCreate
        .mockRejectedValueOnce(new MockAPIConnectionError())
        .mockResolvedValueOnce(
          makeStreamChunks(["ok"], { prompt_tokens: 1, completion_tokens: 1 }),
        );

      const result = await provider.openaiProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe("thinking support", () => {
    it("should pass reasoning_effort for o4-mini and stream normally", async () => {
      mockCreate.mockResolvedValue(
        makeStreamChunks(["reasoned"], { prompt_tokens: 10, completion_tokens: 5 }),
      );

      const result = await provider.openaiProvider.draft(
        { apiKey: "key", model: "o4-mini" },
        { userPrompt: "test" },
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("reasoned");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_effort: "medium",
          stream: true,
        }),
      );
    });

    it("should NOT pass reasoning_effort for default model gpt-5.2", async () => {
      mockCreate.mockResolvedValue(
        makeStreamChunks(["ok"], { prompt_tokens: 5, completion_tokens: 2 }),
      );

      await provider.openaiProvider.draft(config, { userPrompt: "test" });

      const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("reasoning_effort");
      expect(callArgs.stream).toBe(true);
    });

    it("should use non-streaming for o3 with reasoning_effort", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "o3 result" } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      });

      const result = await provider.openaiProvider.draft(
        { apiKey: "key", model: "o3" },
        { userPrompt: "test" },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("o3 result");
        expect(result.data.tokensIn).toBe(12);
        expect(result.data.tokensOut).toBe(8);
      }
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_effort: "medium",
          model: "o3",
        }),
      );
      const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("stream");
    });

    it("should pass reasoning_effort for o4-mini in structuredOutput", async () => {
      mockCreate.mockResolvedValue(makeJsonResponse({ score: 4 }));

      await provider.openaiProvider.structuredOutput(
        { apiKey: "key", model: "o4-mini" },
        structuredReq,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning_effort: "medium" }),
      );
    });

    it("should NOT pass reasoning_effort for gpt-5.2 in structuredOutput", async () => {
      mockCreate.mockResolvedValue(makeJsonResponse({ score: 4 }));

      await provider.openaiProvider.structuredOutput(config, structuredReq);

      const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("reasoning_effort");
    });

    it("should fall back to streaming without reasoning on o4-mini rejection", async () => {
      const reasoningError = Object.assign(
        new Error("invalid reasoning_effort for this model"),
        { status: 400 },
      );
      mockCreate
        .mockRejectedValueOnce(reasoningError)
        .mockResolvedValueOnce(
          makeStreamChunks(["fallback"], { prompt_tokens: 5, completion_tokens: 2 }),
        );

      const result = await provider.openaiProvider.draft(
        { apiKey: "key", model: "o4-mini" },
        { userPrompt: "test" },
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("fallback");
      expect(mockCreate).toHaveBeenCalledTimes(2);
      // Second call: streaming without reasoning_effort
      const secondCallArgs = mockCreate.mock.calls[1]![0] as Record<string, unknown>;
      expect(secondCallArgs).not.toHaveProperty("reasoning_effort");
      expect(secondCallArgs.stream).toBe(true);
    });

    it("should fall back to non-streaming without reasoning for o3 rejection", async () => {
      const reasoningError = Object.assign(
        new Error("invalid reasoning_effort for this model"),
        { status: 400 },
      );
      mockCreate
        .mockRejectedValueOnce(reasoningError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: "o3 fallback" } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        });

      const result = await provider.openaiProvider.draft(
        { apiKey: "key", model: "o3" },
        { userPrompt: "test" },
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("o3 fallback");
      // Fallback should also be non-streaming (o3 can't stream)
      const secondCallArgs = mockCreate.mock.calls[1]![0] as Record<string, unknown>;
      expect(secondCallArgs).not.toHaveProperty("reasoning_effort");
      expect(secondCallArgs).not.toHaveProperty("stream");
    });

    it("should not re-trigger reasoning rejection on structuredOutput retries", async () => {
      const reasoningError = Object.assign(
        new Error("invalid reasoning_effort for this model"),
        { status: 400 },
      );
      // Attempt 1: reasoning rejected → fallback without reasoning → bad JSON
      // Attempt 2: no reasoning (mutable flag off) → valid JSON
      mockCreate
        .mockRejectedValueOnce(reasoningError)
        .mockResolvedValueOnce({ choices: [{ message: { content: "bad json" } }] })
        .mockResolvedValueOnce(makeJsonResponse({ score: 5 }));

      const result = await provider.openaiProvider.structuredOutput<{ score: number }>(
        { apiKey: "key", model: "o4-mini" },
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(5);
      expect(mockCreate).toHaveBeenCalledTimes(3);
      // Call 1: with reasoning_effort (rejected)
      expect(mockCreate.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ reasoning_effort: "medium" }),
      );
      // Call 2: fallback without reasoning_effort
      const secondCallArgs = mockCreate.mock.calls[1]![0] as Record<string, unknown>;
      expect(secondCallArgs).not.toHaveProperty("reasoning_effort");
      // Call 3: retry still without reasoning_effort (mutable flag persists)
      const thirdCallArgs = mockCreate.mock.calls[2]![0] as Record<string, unknown>;
      expect(thirdCallArgs).not.toHaveProperty("reasoning_effort");
    });

    it("should compose fallback → transient retry correctly", async () => {
      const reasoningError = Object.assign(
        new Error("invalid reasoning_effort"),
        { status: 400 },
      );
      const error503 = new MockAPIError(503, "Service unavailable");

      mockCreate
        .mockRejectedValueOnce(reasoningError)  // thinking → 400 → fallback
        .mockRejectedValueOnce(error503)         // fallback → 503 → transient retry
        .mockResolvedValueOnce(                  // retry → success
          makeStreamChunks(["recovered"], { prompt_tokens: 5, completion_tokens: 2 }),
        );

      const result = await provider.openaiProvider.draft(
        { apiKey: "key", model: "o4-mini" },
        { userPrompt: "test" },
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("recovered");
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe("validateKey", () => {
    it("should return success true for valid key", async () => {
      mockModelsList.mockResolvedValue({ data: [{ id: "gpt-5.2" }] });

      const result = await provider.openaiProvider.validateKey(config);

      expect(result).toEqual({ success: true, data: true });
    });

    it("should return success false for invalid key", async () => {
      mockModelsList.mockRejectedValue(new MockAPIError(401, "Unauthorized"));

      const result = await provider.openaiProvider.validateKey(config);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });
  });
});
