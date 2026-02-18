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
  constructor() { super("Connection refused"); }
}

const mockCreate = vi.fn();
const mockModelsList = vi.fn();

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
      expect(provider.openaiProvider.meta.defaultModel).toBe("gpt-4o");
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
        expect(result.data.model).toBe("gpt-4o");
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
  });

  describe("validateKey", () => {
    it("should return success true for valid key", async () => {
      mockModelsList.mockResolvedValue({ data: [{ id: "gpt-4o" }] });

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
