import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineConfig, PipelineResult, ProviderWithConfig } from "../types/pipeline.js";
import type { ReviewPromptParams, SynthesisPromptParams } from "../types/pipeline.js";
import type { DraftResponse } from "../providers/types.js";
import type { CrossReview } from "../types/cross-review.js";
import type { SynthesisResponse } from "../types/synthesis-response.js";
import { CROSS_REVIEW_SCHEMA } from "../schemas/cross-review.schema.js";
import { SYNTHESIS_RESPONSE_SCHEMA } from "../schemas/synthesis-response.schema.js";

vi.mock("../engine/orchestrator.js", () => ({
  runPipeline: vi.fn(),
}));

import { runPipeline } from "../engine/orchestrator.js";
import { general } from "./general.js";
import type { GeneralInput } from "./general.js";

const mockRunPipeline = runPipeline as ReturnType<typeof vi.fn>;

function createMockProvider(id: string, defaultModel: string = `${id}-model`): ProviderWithConfig {
  return {
    provider: {
      meta: { id, name: id.charAt(0).toUpperCase() + id.slice(1), defaultModel },
      draft: vi.fn(),
      structuredOutput: vi.fn(),
      validateKey: vi.fn(),
    },
    config: { apiKey: `${id}-key` },
  };
}

function makeSuccessPipelineResult(overrides?: Partial<PipelineResult>): PipelineResult {
  const draftResponse: DraftResponse = {
    content: "Draft content",
    model: "test-model",
    tokensIn: 100,
    tokensOut: 200,
    durationMs: 500,
  };

  const review: CrossReview = {
    scores: [{ response_id: "Response A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 }],
    issues: ["Test issue"],
    disagreements: [],
    missing_info: [],
    confidence: 0.8,
    confidence_reason: "Test confidence",
    notes: "",
  };

  const synthesis: SynthesisResponse = {
    output: "Synthesized output",
    resolved_disagreements: [],
    open_questions: [],
    action_items: [{ priority: "P0", item: "Do the thing" }],
    confidence: 0.9,
    confidence_reason: "Good synthesis",
  };

  return {
    status: "success",
    drafts: new Map([
      ["anthropic", { status: "success", response: draftResponse }],
      ["openai", { status: "success", response: { ...draftResponse, model: "openai-model" } }],
    ]),
    reviews: new Map([
      ["anthropic", { status: "success", review }],
      ["openai", { status: "success", review }],
    ]),
    synthesis,
    mapping: new Map([["Response A", "anthropic"], ["Response B", "openai"]]),
    errors: [],
    telemetry: {
      totalDurationMs: 1000,
      stageDurationMs: { draft: 400, review: 400, synthesis: 200 },
      draftTokens: { anthropic: { tokensIn: 100, tokensOut: 200 } },
    },
    ...overrides,
  };
}

function makeDefaultInput(): GeneralInput {
  return {
    prompt: "What are the tradeoffs between microservices and monoliths?",
    providers: [createMockProvider("anthropic"), createMockProvider("openai")],
    synthesizer: createMockProvider("anthropic"),
  };
}

let capturedConfig: PipelineConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mockRunPipeline.mockImplementation(async (config: PipelineConfig) => {
    capturedConfig = config;
    return makeSuccessPipelineResult();
  });
});

describe("general", () => {
  describe("Draft prompt construction", () => {
    it("should pass prompt directly without plan-specific header", async () => {
      const input = makeDefaultInput();
      await general(input);

      expect(capturedConfig.prompt).toContain("What are the tradeoffs between microservices and monoliths?");
      expect(capturedConfig.prompt).not.toContain("## Plan to Review");
    });

    it("should set general-purpose system prompt", async () => {
      const input = makeDefaultInput();
      await general(input);

      expect(capturedConfig.systemPrompt).toContain("expert analyst");
      expect(capturedConfig.systemPrompt).toContain("multi-perspective deliberation");
      expect(capturedConfig.systemPrompt).toContain("Correctness");
      expect(capturedConfig.systemPrompt).toContain("Completeness");
      expect(capturedConfig.systemPrompt).toContain("Actionability");
      expect(capturedConfig.systemPrompt).toContain("Clarity");
      expect(capturedConfig.systemPrompt).not.toContain("plan");
    });

    it("should include context when provided", async () => {
      const input = makeDefaultInput();
      input.context = "We are building a SaaS product with 1000 daily active users";
      await general(input);

      expect(capturedConfig.prompt).toContain("## Additional Context");
      expect(capturedConfig.prompt).toContain("We are building a SaaS product with 1000 daily active users");
    });

    it("should omit context section when not provided", async () => {
      const input = makeDefaultInput();
      await general(input);

      expect(capturedConfig.prompt).not.toContain("## Additional Context");
    });
  });

  describe("Cross-review prompt construction", () => {
    it("should use shared generic review prompt builder", async () => {
      const input = makeDefaultInput();
      await general(input);

      const params: ReviewPromptParams = {
        userPrompt: capturedConfig.prompt,
        responses: [
          { label: "Response A", content: "Microservices are better" },
          { label: "Response B", content: "Monoliths are better" },
        ],
      };

      const { userPrompt, systemPrompt } = capturedConfig.review.buildPrompt(params);

      expect(userPrompt).toContain("Response A");
      expect(userPrompt).toContain("Response B");
      expect(userPrompt).toContain("Microservices are better");
      expect(userPrompt).toContain("Monoliths are better");
      expect(userPrompt).toContain('"scores"');
      expect(userPrompt).toContain('"disagreements"');
      expect(systemPrompt).toContain("critical reviewer");
    });
  });

  describe("Synthesis prompt construction", () => {
    it("should use shared generic synthesis prompt builder", async () => {
      const input = makeDefaultInput();
      await general(input);

      const params: SynthesisPromptParams = {
        userPrompt: capturedConfig.prompt,
        drafts: [{ label: "Response A", content: "Draft A" }],
        reviews: [{
          reviewerId: "anthropic",
          review: {
            scores: [{ response_id: "Response A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 }],
            issues: ["Missing nuance"],
            disagreements: [],
            missing_info: [],
            confidence: 0.8,
            confidence_reason: "test",
            notes: "",
          },
        }],
      };

      const { userPrompt, systemPrompt } = capturedConfig.synthesis.buildPrompt(params);

      expect(userPrompt).toContain("Draft A");
      expect(userPrompt).toContain("Missing nuance");
      expect(userPrompt).toContain('"output"');
      expect(userPrompt).toContain('"action_items"');
      expect(systemPrompt).toContain("lead synthesizer");
    });
  });

  describe("Schema and tool config", () => {
    it("should use correct schemas and tool metadata", async () => {
      const input = makeDefaultInput();
      await general(input);

      expect(capturedConfig.review.schema).toBe(CROSS_REVIEW_SCHEMA);
      expect(capturedConfig.synthesis.schema).toBe(SYNTHESIS_RESPONSE_SCHEMA);
      expect(capturedConfig.review.toolName).toBe("submit_review");
      expect(capturedConfig.synthesis.toolName).toBe("submit_synthesis");
    });
  });

  describe("WorkflowResult mapping", () => {
    it("should populate WorkflowResult with workflow type 'general'", async () => {
      const input = makeDefaultInput();
      const pipelineResult = makeSuccessPipelineResult();
      mockRunPipeline.mockResolvedValue(pipelineResult);

      const result = await general(input);

      expect(result.status).toBe("success");
      expect(result.input.prompt).toBe("What are the tradeoffs between microservices and monoliths?");
      expect(result.input.workflow).toBe("general");
      expect(result.input.models).toContain("anthropic/anthropic-model");
      expect(result.input.models).toContain("openai/openai-model");
      expect(result.input.synthesizer).toBe("anthropic/anthropic-model");
      expect(result.stages.drafts).toBe(pipelineResult.drafts);
      expect(result.stages.reviews).toBe(pipelineResult.reviews);
      expect(result.stages.synthesis).toBe(pipelineResult.synthesis);
      expect(result.pipeline).toBe(pipelineResult);
    });

    it("should propagate failed pipeline status", async () => {
      const input = makeDefaultInput();
      const failedResult = makeSuccessPipelineResult({
        status: "failed",
        synthesis: null,
        errors: [{ stage: "draft", model: "anthropic", error: "API error" }],
      });
      mockRunPipeline.mockResolvedValue(failedResult);

      const result = await general(input);

      expect(result.status).toBe("failed");
      expect(result.stages.synthesis).toBeNull();
      expect(result.errors).toHaveLength(1);
    });

    it("should propagate partial pipeline status", async () => {
      const input = makeDefaultInput();
      const partialResult = makeSuccessPipelineResult({
        status: "partial",
        errors: [{ stage: "review", model: "openai", error: "Timeout" }],
      });
      mockRunPipeline.mockResolvedValue(partialResult);

      const result = await general(input);

      expect(result.status).toBe("partial");
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("onProgress passthrough", () => {
    it("should pass onProgress from GeneralInput to PipelineConfig", async () => {
      const input = makeDefaultInput();
      const onProgress = vi.fn();
      input.onProgress = onProgress;
      await general(input);

      expect(capturedConfig.onProgress).toBe(onProgress);
    });
  });
});
