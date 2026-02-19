import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  WorkflowResult,
  PipelineResult,
  SynthesisResponse,
  DraftResponse,
  CrossReview,
  GeneralInput,
} from "@llmtium/core";

vi.mock("@llmtium/core", () => ({
  general: vi.fn(),
  anthropicProvider: {
    meta: { id: "anthropic", name: "Anthropic", defaultModel: "claude-opus-4-6" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  openaiProvider: {
    meta: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.2" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  googleProvider: {
    meta: { id: "google", name: "Google", defaultModel: "gemini-2.5-flash" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
}));

import { general } from "@llmtium/core";
import { handleDeliberate } from "./deliberate.js";

const mockGeneral = general as ReturnType<typeof vi.fn>;

function makeSynthesis(): SynthesisResponse {
  return {
    output: "Synthesized output text",
    resolved_disagreements: [],
    open_questions: [],
    action_items: [{ priority: "P0", item: "Do the thing" }],
    confidence: 0.9,
    confidence_reason: "Good synthesis",
  };
}

function makePipelineResult(overrides?: Partial<PipelineResult>): PipelineResult {
  const draft: DraftResponse = {
    content: "Draft",
    model: "test",
    tokensIn: 100,
    tokensOut: 200,
    durationMs: 500,
  };
  const review: CrossReview = {
    scores: [],
    issues: [],
    disagreements: [],
    missing_info: [],
    confidence: 0.8,
    confidence_reason: "Test",
    notes: "",
  };
  return {
    status: "success",
    drafts: new Map([
      ["anthropic", { status: "success" as const, response: draft }],
      ["openai", { status: "success" as const, response: draft }],
    ]),
    reviews: new Map([
      ["anthropic", { status: "success" as const, review }],
      ["openai", { status: "success" as const, review }],
    ]),
    synthesis: makeSynthesis(),
    mapping: new Map([["Response A", "anthropic"], ["Response B", "openai"]]),
    errors: [],
    telemetry: {
      totalDurationMs: 5000,
      stageDurationMs: { draft: 2000, review: 2000, synthesis: 1000 },
      draftTokens: { anthropic: { tokensIn: 100, tokensOut: 200 } },
    },
    ...overrides,
  };
}

function makeWorkflowResult(overrides?: Partial<WorkflowResult>): WorkflowResult {
  const pipeline = makePipelineResult();
  return {
    status: "success",
    input: {
      prompt: "Test prompt",
      workflow: "general",
      models: ["anthropic", "openai"],
      synthesizer: "anthropic",
    },
    stages: {
      drafts: pipeline.drafts,
      reviews: pipeline.reviews,
      synthesis: pipeline.synthesis,
      mapping: pipeline.mapping,
    },
    errors: [],
    telemetry: pipeline.telemetry,
    pipeline,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
  vi.stubEnv("GOOGLE_API_KEY", "google-test");
  mockGeneral.mockResolvedValue(makeWorkflowResult());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleDeliberate", () => {
  describe("provider resolution", () => {
    it("should use all providers with env keys set when models param is omitted", async () => {
      await handleDeliberate({ prompt: "Test prompt" });

      expect(mockGeneral).toHaveBeenCalledOnce();
      const input = mockGeneral.mock.calls[0]![0] as GeneralInput;
      expect(input.providers).toHaveLength(3);
      const ids = input.providers.map((p) => p.provider.meta.id);
      expect(ids).toContain("anthropic");
      expect(ids).toContain("openai");
      expect(ids).toContain("google");
    });

    it("should filter to only requested model IDs", async () => {
      await handleDeliberate({ prompt: "Test prompt", models: ["anthropic", "openai"] });

      const input = mockGeneral.mock.calls[0]![0] as GeneralInput;
      expect(input.providers).toHaveLength(2);
      const ids = input.providers.map((p) => p.provider.meta.id);
      expect(ids).toContain("anthropic");
      expect(ids).toContain("openai");
      expect(ids).not.toContain("google");
    });

    it("should return error when fewer than 2 providers have keys", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("GOOGLE_API_KEY", "");

      const result = await handleDeliberate({ prompt: "Test prompt" });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("at least 2");
      expect(mockGeneral).not.toHaveBeenCalled();
    });

    it("should return error when models is an empty array", async () => {
      const result = await handleDeliberate({ prompt: "Test prompt", models: [] });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("must not be empty");
      expect(mockGeneral).not.toHaveBeenCalled();
    });

    it("should return error when requested model has no API key", async () => {
      vi.stubEnv("GOOGLE_API_KEY", "");

      const result = await handleDeliberate({ prompt: "Test prompt", models: ["anthropic", "google"] });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("google");
      expect(result.content[0]!.text).toContain("GOOGLE_API_KEY");
      expect(mockGeneral).not.toHaveBeenCalled();
    });
  });

  describe("synthesizer resolution", () => {
    it("should default to anthropic as synthesizer", async () => {
      await handleDeliberate({ prompt: "Test prompt" });

      const input = mockGeneral.mock.calls[0]![0] as GeneralInput;
      expect(input.synthesizer.provider.meta.id).toBe("anthropic");
    });

    it("should use specified synthesizer when provided", async () => {
      await handleDeliberate({ prompt: "Test prompt", synthesizer: "openai" });

      const input = mockGeneral.mock.calls[0]![0] as GeneralInput;
      expect(input.synthesizer.provider.meta.id).toBe("openai");
    });

    it("should return error when synthesizer has no API key", async () => {
      vi.stubEnv("GOOGLE_API_KEY", "");

      const result = await handleDeliberate({ prompt: "Test prompt", synthesizer: "google" });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("google");
      expect(result.content[0]!.text).toContain("GOOGLE_API_KEY");
    });
  });

  describe("workflow execution", () => {
    it("should pass prompt and context through to general", async () => {
      await handleDeliberate({ prompt: "Analyze this data", context: "CSV format" });

      const input = mockGeneral.mock.calls[0]![0] as GeneralInput;
      expect(input.prompt).toBe("Analyze this data");
      expect(input.context).toBe("CSV format");
    });

    it("should return formatted text content on success", async () => {
      const result = await handleDeliberate({ prompt: "Test prompt" });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(result.content[0]!.text).toContain("SYNTHESIS");
      expect(result.content[0]!.text).toContain("Synthesized output text");
    });

    it("should return formatted text with warnings on partial", async () => {
      mockGeneral.mockResolvedValue(makeWorkflowResult({
        status: "partial",
        errors: [{ stage: "draft", model: "google", error: "Rate limit" }],
      }));

      const result = await handleDeliberate({ prompt: "Test prompt" });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain("WARNINGS");
      expect(result.content[0]!.text).toContain("Rate limit");
    });

    it("should return isError on pipeline failure", async () => {
      const failedPipeline = makePipelineResult({
        status: "failed",
        synthesis: null,
        errors: [{ stage: "draft", model: "anthropic", error: "API error" }],
      });
      mockGeneral.mockResolvedValue(makeWorkflowResult({
        status: "failed",
        errors: [{ stage: "draft", model: "anthropic", error: "API error" }],
        pipeline: failedPipeline,
      }));

      const result = await handleDeliberate({ prompt: "Test prompt" });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("API error");
    });

    it("should handle unexpected exceptions gracefully", async () => {
      mockGeneral.mockRejectedValue(new Error("Unexpected crash"));

      const result = await handleDeliberate({ prompt: "Test prompt" });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("Internal error");
      expect(result.content[0]!.text).toContain("Unexpected crash");
    });
  });

  describe("deduplication", () => {
    it("should deduplicate model IDs", async () => {
      await handleDeliberate({ prompt: "Test prompt", models: ["anthropic", "anthropic", "openai"] });

      const input = mockGeneral.mock.calls[0]![0] as GeneralInput;
      expect(input.providers).toHaveLength(2);
    });
  });
});
