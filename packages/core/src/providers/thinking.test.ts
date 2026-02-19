import { describe, it, expect, vi } from "vitest";
import {
  getAnthropicThinkingConfig,
  getOpenAIReasoningConfig,
  getGoogleThinkingConfig,
  isThinkingRejection,
  withThinkingFallback,
  ANTHROPIC_THINKING_PATTERN,
  OPENAI_REASONING_PATTERN,
  GOOGLE_THINKING_PATTERN,
} from "./thinking.js";

describe("getAnthropicThinkingConfig", () => {
  it("should return adaptive for claude-opus-4-6", () => {
    const config = getAnthropicThinkingConfig("claude-opus-4-6");
    expect(config).toEqual({
      thinking: { type: "adaptive" },
      maxTokens: 16384,
    });
  });

  it("should return adaptive for claude-sonnet-4-6", () => {
    const config = getAnthropicThinkingConfig("claude-sonnet-4-6");
    expect(config).toEqual({
      thinking: { type: "adaptive" },
      maxTokens: 16384,
    });
  });

  it("should return enabled with budget for claude-haiku-4-5-20251001", () => {
    const config = getAnthropicThinkingConfig("claude-haiku-4-5-20251001");
    expect(config).toEqual({
      thinking: { type: "enabled", budget_tokens: 8192 },
      maxTokens: 16384,
    });
  });

  it("should return enabled with budget for claude-3-7-sonnet-20250219", () => {
    const config = getAnthropicThinkingConfig("claude-3-7-sonnet-20250219");
    expect(config).toEqual({
      thinking: { type: "enabled", budget_tokens: 8192 },
      maxTokens: 16384,
    });
  });

  it("should return null for claude-3-5-sonnet-20241022", () => {
    expect(getAnthropicThinkingConfig("claude-3-5-sonnet-20241022")).toBeNull();
  });

  it("should return null for unknown model", () => {
    expect(getAnthropicThinkingConfig("some-random-model")).toBeNull();
  });
});

describe("getOpenAIReasoningConfig", () => {
  it("should return reasoning without streaming for o3", () => {
    expect(getOpenAIReasoningConfig("o3")).toEqual({
      reasoningEffort: "medium",
      supportsStreaming: false,
    });
  });

  it("should return reasoning without streaming for o3-mini", () => {
    expect(getOpenAIReasoningConfig("o3-mini")).toEqual({
      reasoningEffort: "medium",
      supportsStreaming: false,
    });
  });

  it("should return reasoning with streaming for o4-mini", () => {
    expect(getOpenAIReasoningConfig("o4-mini")).toEqual({
      reasoningEffort: "medium",
      supportsStreaming: true,
    });
  });

  it("should return null for gpt-5.2 (excluded from auto)", () => {
    expect(getOpenAIReasoningConfig("gpt-5.2")).toBeNull();
  });

  it("should return null for gpt-5 (excluded from auto)", () => {
    expect(getOpenAIReasoningConfig("gpt-5")).toBeNull();
  });

  it("should return null for gpt-4o", () => {
    expect(getOpenAIReasoningConfig("gpt-4o")).toBeNull();
  });

  it("should return null for gpt-4o-mini", () => {
    expect(getOpenAIReasoningConfig("gpt-4o-mini")).toBeNull();
  });
});

describe("getGoogleThinkingConfig", () => {
  it("should return auto budget for gemini-2.5-flash", () => {
    expect(getGoogleThinkingConfig("gemini-2.5-flash")).toEqual({
      thinkingBudget: -1,
    });
  });

  it("should return auto budget for gemini-2.5-pro", () => {
    expect(getGoogleThinkingConfig("gemini-2.5-pro")).toEqual({
      thinkingBudget: -1,
    });
  });

  it("should return auto budget for gemini-3-flash-preview", () => {
    expect(getGoogleThinkingConfig("gemini-3-flash-preview")).toEqual({
      thinkingBudget: -1,
    });
  });

  it("should return null for gemini-2.0-flash", () => {
    expect(getGoogleThinkingConfig("gemini-2.0-flash")).toBeNull();
  });

  it("should return null for unknown model", () => {
    expect(getGoogleThinkingConfig("some-model")).toBeNull();
  });
});

describe("isThinkingRejection", () => {
  describe("with ANTHROPIC_THINKING_PATTERN", () => {
    it("should return true for 400 + 'thinking parameter not supported'", () => {
      const error = Object.assign(new Error("thinking parameter not supported"), { status: 400 });
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(true);
    });

    it("should return true for 400 + 'invalid budget_tokens'", () => {
      const error = Object.assign(new Error("invalid budget_tokens"), { status: 400 });
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(true);
    });

    it("should return true for 400 + 'invalid budget tokens' (spaced)", () => {
      const error = Object.assign(new Error("invalid budget tokens"), { status: 400 });
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(true);
    });

    it("should return false for 400 + 'Bad request: invalid schema' (no thinking keyword)", () => {
      const error = Object.assign(new Error("Bad request: invalid schema"), { status: 400 });
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(false);
    });
  });

  describe("with OPENAI_REASONING_PATTERN", () => {
    it("should return true for 400 + 'invalid reasoning_effort value'", () => {
      const error = Object.assign(new Error("invalid reasoning_effort value"), { status: 400 });
      expect(isThinkingRejection(error, OPENAI_REASONING_PATTERN)).toBe(true);
    });

    it("should return true for 400 + 'invalid reasoning effort' (spaced)", () => {
      const error = Object.assign(new Error("invalid reasoning effort"), { status: 400 });
      expect(isThinkingRejection(error, OPENAI_REASONING_PATTERN)).toBe(true);
    });

    it("should return false for 400 + 'Bad request: invalid schema'", () => {
      const error = Object.assign(new Error("Bad request: invalid schema"), { status: 400 });
      expect(isThinkingRejection(error, OPENAI_REASONING_PATTERN)).toBe(false);
    });
  });

  describe("with GOOGLE_THINKING_PATTERN", () => {
    it("should return true for 400 + 'unsupported thinkingConfig'", () => {
      const error = Object.assign(new Error("unsupported thinkingConfig"), { status: 400 });
      expect(isThinkingRejection(error, GOOGLE_THINKING_PATTERN)).toBe(true);
    });

    it("should return true for 400 + 'invalid thinkingBudget'", () => {
      const error = Object.assign(new Error("invalid thinkingBudget"), { status: 400 });
      expect(isThinkingRejection(error, GOOGLE_THINKING_PATTERN)).toBe(true);
    });

    it("should return true for 400 + 'invalid thinking_config' (snake_case)", () => {
      const error = Object.assign(new Error("invalid thinking_config"), { status: 400 });
      expect(isThinkingRejection(error, GOOGLE_THINKING_PATTERN)).toBe(true);
    });

    it("should return true for 400 + 'invalid thinking_budget' (snake_case)", () => {
      const error = Object.assign(new Error("invalid thinking_budget"), { status: 400 });
      expect(isThinkingRejection(error, GOOGLE_THINKING_PATTERN)).toBe(true);
    });
  });

  describe("cross-cutting", () => {
    it("should return false for 401 with matching keyword (wrong status)", () => {
      const error = Object.assign(new Error("thinking not supported"), { status: 401 });
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(false);
    });

    it("should return false for 503 with matching keyword (wrong status)", () => {
      const error = Object.assign(new Error("thinking service unavailable"), { status: 503 });
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(false);
    });

    it("should return false for non-Error values", () => {
      expect(isThinkingRejection("string error", ANTHROPIC_THINKING_PATTERN)).toBe(false);
      expect(isThinkingRejection(null, ANTHROPIC_THINKING_PATTERN)).toBe(false);
      expect(isThinkingRejection(undefined, ANTHROPIC_THINKING_PATTERN)).toBe(false);
    });

    it("should return false for Error without status", () => {
      const error = new Error("thinking not supported");
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(false);
    });

    it("should return true for plain object with status 400 and matching message", () => {
      const error = { status: 400, message: "thinking not supported" };
      expect(isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)).toBe(true);
    });
  });
});

describe("withThinkingFallback", () => {
  const dummyPattern = /test/i;

  it("should call attemptWithoutThinking directly when thinkingEnabled is false", async () => {
    const withThinking = vi.fn();
    const withoutThinking = vi.fn().mockResolvedValue("no-thinking-result");

    const result = await withThinkingFallback(false, dummyPattern, withThinking, withoutThinking);

    expect(result).toBe("no-thinking-result");
    expect(withThinking).not.toHaveBeenCalled();
    expect(withoutThinking).toHaveBeenCalledTimes(1);
  });

  it("should return result from attemptWithThinking on success", async () => {
    const withThinking = vi.fn().mockResolvedValue("thinking-result");
    const withoutThinking = vi.fn();

    const result = await withThinkingFallback(true, dummyPattern, withThinking, withoutThinking);

    expect(result).toBe("thinking-result");
    expect(withThinking).toHaveBeenCalledTimes(1);
    expect(withoutThinking).not.toHaveBeenCalled();
  });

  it("should fall back to attemptWithoutThinking on thinking rejection", async () => {
    const thinkingError = Object.assign(new Error("test parameter not supported"), { status: 400 });
    const withThinking = vi.fn().mockRejectedValue(thinkingError);
    const withoutThinking = vi.fn().mockResolvedValue("fallback-result");

    const result = await withThinkingFallback(true, dummyPattern, withThinking, withoutThinking);

    expect(result).toBe("fallback-result");
    expect(withThinking).toHaveBeenCalledTimes(1);
    expect(withoutThinking).toHaveBeenCalledTimes(1);
  });

  it("should propagate 400 without matching keyword", async () => {
    const genericError = Object.assign(new Error("Bad request: invalid schema"), { status: 400 });
    const withThinking = vi.fn().mockRejectedValue(genericError);
    const withoutThinking = vi.fn();

    await expect(
      withThinkingFallback(true, dummyPattern, withThinking, withoutThinking),
    ).rejects.toThrow("Bad request: invalid schema");
    expect(withoutThinking).not.toHaveBeenCalled();
  });

  it("should propagate 503 error without fallback", async () => {
    const transientError = Object.assign(new Error("Service unavailable"), { status: 503 });
    const withThinking = vi.fn().mockRejectedValue(transientError);
    const withoutThinking = vi.fn();

    await expect(
      withThinkingFallback(true, dummyPattern, withThinking, withoutThinking),
    ).rejects.toThrow("Service unavailable");
    expect(withoutThinking).not.toHaveBeenCalled();
  });

  it("should propagate non-Error rejections", async () => {
    const withThinking = vi.fn().mockRejectedValue("string error");
    const withoutThinking = vi.fn();

    await expect(
      withThinkingFallback(true, dummyPattern, withThinking, withoutThinking),
    ).rejects.toBe("string error");
    expect(withoutThinking).not.toHaveBeenCalled();
  });
});
