import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderConfig, StructuredRequest } from "./types.js";

// --- Mock setup ---

const mockGenerateContentStream = vi.fn();
const mockGenerateContent = vi.fn();

vi.mock("./transient-retry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./transient-retry.js")>();
  return {
    ...mod,
    withTransientRetry: <T>(fn: () => Promise<T>, maxRetries?: number, baseDelayMs?: number) =>
      mod.withTransientRetry(fn, maxRetries, baseDelayMs, () => Promise.resolve()),
  };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({
    models: {
      generateContentStream: mockGenerateContentStream,
      generateContent: mockGenerateContent,
    },
  })),
}));

// --- Helpers ---

function makeStreamChunks(
  texts: string[],
  usage: { promptTokenCount: number; candidatesTokenCount: number },
) {
  const chunks = texts.map((text) => ({
    text,
    usageMetadata: undefined as
      | { promptTokenCount: number; candidatesTokenCount: number }
      | undefined,
  }));
  // Last chunk carries usage metadata
  if (chunks.length > 0) {
    chunks[chunks.length - 1]!.usageMetadata = usage;
  }
  return (async function* () {
    yield* chunks;
  })();
}

function makeContentResult(text: string) {
  return { text: text || undefined };
}

const config: ProviderConfig = { apiKey: "test-google-key" };
const structuredReq: StructuredRequest = {
  userPrompt: "Review these responses",
  systemPrompt: "You are a reviewer",
  schema: { type: "object", properties: { score: { type: "number" } } },
  toolName: "submit_review",
  toolDescription: "Submit your review",
};

// --- Tests ---

describe("googleProvider", () => {
  let provider: typeof import("./google.js");

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await import("./google.js");
  });

  describe("meta", () => {
    it("should have correct id, name, and defaultModel", () => {
      expect(provider.googleProvider.meta.id).toBe("google");
      expect(provider.googleProvider.meta.name).toBe("Google");
      expect(provider.googleProvider.meta.defaultModel).toBe("gemini-2.5-flash");
    });
  });

  describe("draft", () => {
    it("should collect text from streamed chunks", async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeStreamChunks(["Hello", " world"], { promptTokenCount: 6, candidatesTokenCount: 3 }),
      );

      const result = await provider.googleProvider.draft(config, {
        userPrompt: "Say hello",
        systemPrompt: "Be friendly",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("Hello world");
        expect(result.data.tokensIn).toBe(6);
        expect(result.data.tokensOut).toBe(3);
        expect(result.data.model).toBe("gemini-2.5-flash");
        expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should pass systemPrompt as systemInstruction in config", async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeStreamChunks(["ok"], { promptTokenCount: 1, candidatesTokenCount: 1 }),
      );

      await provider.googleProvider.draft(config, {
        userPrompt: "test",
        systemPrompt: "Be concise",
      });

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ systemInstruction: "Be concise" }),
        }),
      );
    });

    it("should use config.model when provided", async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeStreamChunks(["ok"], { promptTokenCount: 1, candidatesTokenCount: 1 }),
      );

      await provider.googleProvider.draft(
        { apiKey: "key", model: "gemini-2.5-pro" },
        { userPrompt: "test" },
      );

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-2.5-pro" }),
      );
    });

    it("should return error on authentication failure", async () => {
      const apiError = Object.assign(new Error("Unauthorized"), { status: 401 });
      mockGenerateContentStream.mockRejectedValue(apiError);

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });

    it("should return error on network failure", async () => {
      mockGenerateContentStream.mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:443"),
      );

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Connection failed");
    });

    // Persistent rejection exhausts retries, then formatError extracts the inner message
    it("should extract human-readable message from nested JSON error", async () => {
      const nestedMsg = JSON.stringify({
        error: {
          message: JSON.stringify({
            error: {
              code: 503,
              message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
              status: "UNAVAILABLE",
            },
          }),
          code: 503,
          status: "Service Unavailable",
        },
      });
      const apiError = Object.assign(new Error(nestedMsg), { status: 503 });
      mockGenerateContentStream.mockRejectedValue(apiError);

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
        );
      }
    });

    it("should return Connection failed for error with status undefined and ECONNREFUSED", async () => {
      // Simulates @google/genai APIConnectionError which has status=undefined
      const connError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { status: undefined });
      mockGenerateContentStream.mockRejectedValue(connError);

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Connection failed");
    });
  });

  describe("structuredOutput", () => {
    it("should parse JSON from generateContent with responseMimeType", async () => {
      mockGenerateContent.mockResolvedValue(
        makeContentResult('{"score":4.5}'),
      );

      const result = await provider.googleProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(4.5);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            responseMimeType: "application/json",
          }),
        }),
      );
    });

    it("should pass schema via responseJsonSchema without cast", async () => {
      mockGenerateContent.mockResolvedValue(
        makeContentResult('{"score":4.5}'),
      );

      await provider.googleProvider.structuredOutput(config, structuredReq);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            responseJsonSchema: structuredReq.schema,
          }),
        }),
      );
    });

    it("should pass complex nested schema via responseJsonSchema", async () => {
      const complexSchema = {
        type: "object",
        properties: {
          scores: {
            type: "array",
            items: {
              type: "object",
              properties: {
                response_id: { type: "string" },
                correctness: { type: "number" },
                completeness: { type: "number" },
              },
              required: ["response_id", "correctness", "completeness"],
              additionalProperties: false,
            },
          },
          disagreements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topic: { type: "string" },
                a: {
                  type: "object",
                  properties: {
                    response_id: { type: "string" },
                    quote: { type: "string" },
                  },
                  required: ["response_id", "quote"],
                  additionalProperties: false,
                },
              },
              required: ["topic", "a"],
              additionalProperties: false,
            },
          },
        },
        required: ["scores", "disagreements"],
        additionalProperties: false,
      };

      mockGenerateContent.mockResolvedValue(
        makeContentResult(JSON.stringify({
          scores: [{ response_id: "A", correctness: 4, completeness: 3 }],
          disagreements: [],
        })),
      );

      const req = { ...structuredReq, schema: complexSchema };
      const result = await provider.googleProvider.structuredOutput(config, req);

      expect(result.success).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            responseJsonSchema: complexSchema,
          }),
        }),
      );
    });

    it("should return error when response text is empty", async () => {
      mockGenerateContent
        .mockResolvedValueOnce(makeContentResult(""))
        .mockResolvedValueOnce(makeContentResult(""))
        .mockResolvedValueOnce(makeContentResult(""));

      const result = await provider.googleProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Structured output failed");
    });

    it("should retry on invalid JSON and succeed", async () => {
      mockGenerateContent
        .mockResolvedValueOnce(makeContentResult("not json"))
        .mockResolvedValueOnce(makeContentResult('{"score":3}'));

      const result = await provider.googleProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(3);
    });

    it("should return error after 3 consecutive parse failures", async () => {
      mockGenerateContent
        .mockResolvedValueOnce(makeContentResult("bad"))
        .mockResolvedValueOnce(makeContentResult("still bad"))
        .mockResolvedValueOnce(makeContentResult("very bad"));

      const result = await provider.googleProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Structured output failed after 3 attempts");
    });

    it("should fail immediately on non-transient API error without retrying", async () => {
      const apiError = Object.assign(new Error("Bad request"), { status: 400 });
      mockGenerateContent.mockRejectedValueOnce(apiError);

      const result = await provider.googleProvider.structuredOutput(config, structuredReq);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("API error (400)");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should retry on 503 transient error and succeed", async () => {
      const error503 = Object.assign(new Error("Service unavailable"), { status: 503 });
      mockGenerateContent
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(makeContentResult('{"score":4}'));

      const result = await provider.googleProvider.structuredOutput<{ score: number }>(
        config,
        structuredReq,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.score).toBe(4);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("transient retry", () => {
    it("should retry on 503 in draft and succeed", async () => {
      const error503 = Object.assign(new Error("Service unavailable"), { status: 503 });
      mockGenerateContentStream
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(
          makeStreamChunks(["recovered"], { promptTokenCount: 5, candidatesTokenCount: 3 }),
        );

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe("recovered");
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(2);
    });

    it("should exhaust retries on persistent 503 in draft", async () => {
      const error503 = Object.assign(new Error("Service unavailable"), { status: 503 });
      mockGenerateContentStream.mockRejectedValue(error503);

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("API error (503): Service unavailable");
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });

    it("should retry ECONNREFUSED in draft and succeed", async () => {
      mockGenerateContentStream
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:443"))
        .mockResolvedValueOnce(
          makeStreamChunks(["ok"], { promptTokenCount: 1, candidatesTokenCount: 1 }),
        );

      const result = await provider.googleProvider.draft(config, { userPrompt: "test" });

      expect(result.success).toBe(true);
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(2);
    });
  });

  describe("validateKey", () => {
    it("should return success true for valid key", async () => {
      mockGenerateContent.mockResolvedValue(makeContentResult("hi"));

      const result = await provider.googleProvider.validateKey(config);

      expect(result).toEqual({ success: true, data: true });
    });

    it("should return success false for invalid key", async () => {
      const apiError = Object.assign(new Error("Unauthorized"), { status: 401 });
      mockGenerateContent.mockRejectedValue(apiError);

      const result = await provider.googleProvider.validateKey(config);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });
  });
});
