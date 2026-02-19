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
class MockAuthenticationError extends MockAPIError {
  constructor() { super(401, "Invalid API key"); }
}
class MockRateLimitError extends MockAPIError {
  constructor() { super(429, "Rate limited"); }
}
class MockAPIConnectionError extends Error {
  override name = "APIConnectionError";
  constructor() { super("Connection refused"); }
}

const mockStream = vi.fn();
const mockCreate = vi.fn();

vi.mock("./transient-retry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./transient-retry.js")>();
  return {
    ...mod,
    withTransientRetry: <T>(fn: () => Promise<T>, maxRetries?: number, baseDelayMs?: number) =>
      mod.withTransientRetry(fn, maxRetries, baseDelayMs, () => Promise.resolve()),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  const Anthropic = vi.fn(() => ({
    messages: { stream: mockStream, create: mockCreate },
  }));
  return {
    default: Object.assign(Anthropic, {
      APIError: MockAPIError,
      AuthenticationError: MockAuthenticationError,
      RateLimitError: MockRateLimitError,
      APIConnectionError: MockAPIConnectionError,
    }),
  };
});

// --- Helpers ---

function makeStreamResult(text: string, inputTokens: number, outputTokens: number) {
  const events = [
    { type: "content_block_delta", delta: { type: "text_delta", text } },
  ];
  return {
    [Symbol.asyncIterator]: async function* () { yield* events; },
    finalMessage: vi.fn().mockResolvedValue({
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
  };
}

function makeToolUseResponse(input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "submit_review", input }],
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

describe("anthropicProvider", () => {
  let provider: typeof import("./anthropic.js");

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await import("./anthropic.js");
  });

  describe("meta", () => {
    it("should have correct id, name, and defaultModel", () => {
      expect(provider.anthropicProvider.meta.id).toBe("anthropic");
      expect(provider.anthropicProvider.meta.name).toBe("Anthropic");
      expect(provider.anthropicProvider.meta.defaultModel).toBe("claude-opus-4-6");
    });
  });

  describe("draft", () => {
    it("should return content and usage from streaming response", async () => {
      mockStream.mockReturnValue(makeStreamResult("Hello world", 10, 5));

      const result = await provider.anthropicProvider.draft(config, {
        userPrompt: "Say hello",
        systemPrompt: "Be friendly",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("Hello world");
        expect(result.data.tokensIn).toBe(10);
        expect(result.data.tokensOut).toBe(5);
        expect(result.data.model).toBe("claude-opus-4-6");
        expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should use config.model when provided", async () => {
      mockStream.mockReturnValue(makeStreamResult("Hi", 5, 2));

      await provider.anthropicProvider.draft(
        { apiKey: "key", model: "claude-opus-4-20250514" },
        { userPrompt: "test" },
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-opus-4-20250514" }),
      );
    });

    it("should return error on AuthenticationError", async () => {
      mockStream.mockImplementation(() => { throw new MockAuthenticationError(); });

      const result = await provider.anthropicProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });

    it("should return error on network failure", async () => {
      mockStream.mockImplementation(() => { throw new MockAPIConnectionError(); });

      const result = await provider.anthropicProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Connection failed");
    });
  });

  describe("structuredOutput", () => {
    it("should extract tool input from tool_use response block", async () => {
      mockCreate.mockResolvedValue(makeToolUseResponse({ score: 4.5 }));

      const result = await provider.anthropicProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(4.5);
    });

    it("should return error when response has no tool_use block", async () => {
      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "no tool" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "still no tool" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "third fail" }] });

      const result = await provider.anthropicProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Structured output failed after 3 attempts");
    });

    it("should retry on first failure and succeed on second attempt", async () => {
      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "oops" }] })
        .mockResolvedValueOnce(makeToolUseResponse({ score: 3 }));

      const result = await provider.anthropicProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(3);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should return error after 3 consecutive parse failures", async () => {
      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "bad" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "bad" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "bad" }] });

      const result = await provider.anthropicProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Structured output failed after 3 attempts");
    });

    it("should fail immediately on non-transient API error without retrying", async () => {
      mockCreate.mockRejectedValueOnce(new MockAPIError(400, "Bad request"));

      const result = await provider.anthropicProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("API error (400)");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("should retry on 503 transient error and succeed", async () => {
      const error503 = new MockAPIError(503, "Service unavailable");
      mockCreate
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(makeToolUseResponse({ score: 4 }));

      const result = await provider.anthropicProvider.structuredOutput<{ score: number }>(
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
      mockStream
        .mockImplementationOnce(() => { throw error503; })
        .mockReturnValueOnce(makeStreamResult("recovered", 5, 3));

      const result = await provider.anthropicProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("recovered");
      expect(mockStream).toHaveBeenCalledTimes(2);
    });

    it("should exhaust retries on persistent 503 in draft", async () => {
      const error503 = new MockAPIError(503, "Service unavailable");
      mockStream.mockImplementation(() => { throw error503; });

      const result = await provider.anthropicProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("API error (503): Service unavailable");
      expect(mockStream).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });

    it("should retry connection error in draft", async () => {
      mockStream
        .mockImplementationOnce(() => { throw new MockAPIConnectionError(); })
        .mockReturnValueOnce(makeStreamResult("ok", 1, 1));

      const result = await provider.anthropicProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(true);
      expect(mockStream).toHaveBeenCalledTimes(2);
    });
  });

  describe("validateKey", () => {
    it("should return success true for valid key", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "hi" }],
      });

      const result = await provider.anthropicProvider.validateKey(config);

      expect(result).toEqual({ success: true, data: true });
    });

    it("should return success false for invalid key", async () => {
      mockCreate.mockRejectedValue(new MockAuthenticationError());

      const result = await provider.anthropicProvider.validateKey(config);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });
  });
});
