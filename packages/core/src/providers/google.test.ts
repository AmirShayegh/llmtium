import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderConfig, StructuredRequest } from "./types.js";

// --- Mock setup ---

const mockGenerateContentStream = vi.fn();
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContentStream: mockGenerateContentStream,
  generateContent: mockGenerateContent,
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// --- Helpers ---

function makeStreamResult(
  texts: string[],
  usage: { promptTokenCount: number; candidatesTokenCount: number },
) {
  const stream = (async function* () {
    for (const text of texts) {
      yield { text: () => text };
    }
  })();
  return {
    stream,
    response: Promise.resolve({ usageMetadata: usage }),
  };
}

function makeContentResult(text: string) {
  return { response: { text: () => text } };
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
      expect(provider.googleProvider.meta.defaultModel).toBe("gemini-2.0-flash");
    });
  });

  describe("draft", () => {
    it("should collect text from streamed chunks", async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeStreamResult(["Hello", " world"], { promptTokenCount: 6, candidatesTokenCount: 3 }),
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
        expect(result.data.model).toBe("gemini-2.0-flash");
        expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should pass systemPrompt as systemInstruction on model", async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeStreamResult(["ok"], { promptTokenCount: 1, candidatesTokenCount: 1 }),
      );

      await provider.googleProvider.draft(config, {
        userPrompt: "test",
        systemPrompt: "Be concise",
      });

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: "Be concise" }),
      );
    });

    it("should use config.model when provided", async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeStreamResult(["ok"], { promptTokenCount: 1, candidatesTokenCount: 1 }),
      );

      await provider.googleProvider.draft(
        { apiKey: "key", model: "gemini-2.5-pro" },
        { userPrompt: "test" },
      );

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-2.5-pro" }),
      );
    });

    it("should return error on authentication failure", async () => {
      mockGenerateContentStream.mockRejectedValue(
        new Error("API_KEY_INVALID: The provided API key is not valid"),
      );

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
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            responseMimeType: "application/json",
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
  });

  describe("validateKey", () => {
    it("should return success true for valid key", async () => {
      mockGenerateContent.mockResolvedValue(makeContentResult("hi"));

      const result = await provider.googleProvider.validateKey(config);

      expect(result).toEqual({ success: true, data: true });
    });

    it("should return success false for invalid key", async () => {
      mockGenerateContent.mockRejectedValue(
        new Error("API_KEY_INVALID: invalid key"),
      );

      const result = await provider.googleProvider.validateKey(config);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("Invalid API key");
    });
  });
});
