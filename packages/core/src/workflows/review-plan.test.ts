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
import { reviewPlan } from "./review-plan.js";
import type { ReviewPlanInput } from "./review-plan.js";

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

function makeDefaultInput(): ReviewPlanInput {
  return {
    plan: "Build a REST API with authentication",
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

describe("reviewPlan", () => {
  describe("Draft prompt construction", () => {
    it("should include plan text in config.prompt with header", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      expect(capturedConfig.prompt).toContain("## Plan to Review");
      expect(capturedConfig.prompt).toContain("Build a REST API with authentication");
    });

    it("should set review_plan-specific system prompt", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      expect(capturedConfig.systemPrompt).toContain("expert technical reviewer");
      expect(capturedConfig.systemPrompt).toContain("Feasibility");
      expect(capturedConfig.systemPrompt).toContain("Completeness");
      expect(capturedConfig.systemPrompt).toContain("Risks");
      expect(capturedConfig.systemPrompt).toContain("Sequencing");
      expect(capturedConfig.systemPrompt).toContain("Alternatives");
    });

    it("should include context when provided", async () => {
      const input = makeDefaultInput();
      input.context = "We are using Node.js and PostgreSQL";
      await reviewPlan(input);

      expect(capturedConfig.prompt).toContain("## Additional Context");
      expect(capturedConfig.prompt).toContain("We are using Node.js and PostgreSQL");
    });

    it("should omit context section when not provided", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      expect(capturedConfig.prompt).not.toContain("## Additional Context");
    });
  });

  describe("Cross-review prompt construction", () => {
    it("should include original prompt and anonymized labels in review prompt", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      const params: ReviewPromptParams = {
        userPrompt: capturedConfig.prompt,
        responses: [
          { label: "Response A", content: "Use microservices" },
          { label: "Response B", content: "Use monolith" },
        ],
      };

      const { userPrompt } = capturedConfig.review.buildPrompt(params);

      expect(userPrompt).toContain("Response A");
      expect(userPrompt).toContain("Response B");
      expect(userPrompt).toContain("Use microservices");
      expect(userPrompt).toContain("Use monolith");
      expect(userPrompt).toContain(capturedConfig.prompt);
      expect(userPrompt).toContain("Respond with ONLY this JSON structure");
      expect(userPrompt).toContain('"scores"');
      expect(userPrompt).toContain('"disagreements"');
      expect(userPrompt).toContain('"confidence"');
    });

    it("should use correct cross-review system prompt", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      const params: ReviewPromptParams = {
        userPrompt: capturedConfig.prompt,
        responses: [{ label: "Response A", content: "test" }],
      };

      const { systemPrompt } = capturedConfig.review.buildPrompt(params);

      expect(systemPrompt).toContain("critical reviewer");
      expect(systemPrompt).toContain("unbiased evaluation");
    });
  });

  describe("Synthesis prompt construction", () => {
    it("should include drafts and formatted reviews in synthesis prompt", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      const params: SynthesisPromptParams = {
        userPrompt: capturedConfig.prompt,
        drafts: [
          { label: "Response A", content: "Draft A content" },
          { label: "Response B", content: "Draft B content" },
        ],
        reviews: [
          {
            reviewerId: "anthropic",
            review: {
              scores: [{ response_id: "Response B", correctness: 4, completeness: 3, actionability: 5, clarity: 4 }],
              issues: ["Missing error handling"],
              disagreements: [
                {
                  topic: "Database choice",
                  a: { response_id: "Response A", quote: "Use PostgreSQL" },
                  b: { response_id: "Response B", quote: "Use SQLite" },
                  assessment: "PostgreSQL is better at scale",
                  suggested_resolution: "",
                },
              ],
              missing_info: ["No backup strategy"],
              confidence: 0.85,
              confidence_reason: "Domain expertise",
              notes: "",
            },
          },
        ],
      };

      const { userPrompt } = capturedConfig.synthesis.buildPrompt(params);

      expect(userPrompt).toContain("Response A");
      expect(userPrompt).toContain("Response B");
      expect(userPrompt).toContain("Draft A content");
      expect(userPrompt).toContain("Draft B content");
      expect(userPrompt).toContain("correctness=4");
      expect(userPrompt).toContain("Missing error handling");
      expect(userPrompt).toContain("Database choice");
      expect(userPrompt).toContain("Use PostgreSQL");
      expect(userPrompt).toContain("Use SQLite");
      expect(userPrompt).toContain("0.85");
      expect(userPrompt).toContain("No backup strategy");
      expect(userPrompt).toContain("Respond with ONLY this JSON structure");
      expect(userPrompt).toContain('"output"');
      expect(userPrompt).toContain('"resolved_disagreements"');
      expect(userPrompt).toContain('"action_items"');
    });

    it("should use correct synthesis system prompt", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      const params: SynthesisPromptParams = {
        userPrompt: capturedConfig.prompt,
        drafts: [],
        reviews: [],
      };

      const { systemPrompt } = capturedConfig.synthesis.buildPrompt(params);

      expect(systemPrompt).toContain("lead synthesizer");
      expect(systemPrompt).toContain("Do not be a diplomat");
    });
  });

  describe("Schema and tool config", () => {
    it("should use correct review schema and tool metadata", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      const schema = capturedConfig.review.schema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("scores");
      expect(properties).toHaveProperty("issues");
      expect(properties).toHaveProperty("disagreements");
      expect(properties).toHaveProperty("missing_info");
      expect(properties).toHaveProperty("confidence");
      expect(properties).toHaveProperty("confidence_reason");
      expect(capturedConfig.review.toolName).toBe("submit_review");
    });

    it("should use correct synthesis schema and tool metadata", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      const schema = capturedConfig.synthesis.schema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("output");
      expect(properties).toHaveProperty("resolved_disagreements");
      expect(properties).toHaveProperty("open_questions");
      expect(properties).toHaveProperty("action_items");
      expect(properties).toHaveProperty("confidence");
      expect(properties).toHaveProperty("confidence_reason");
      expect(capturedConfig.synthesis.toolName).toBe("submit_synthesis");
    });
  });

  describe("WorkflowResult mapping", () => {
    it("should populate WorkflowResult from successful PipelineResult", async () => {
      const input = makeDefaultInput();
      const pipelineResult = makeSuccessPipelineResult();
      mockRunPipeline.mockResolvedValue(pipelineResult);

      const result = await reviewPlan(input);

      expect(result.status).toBe("success");
      expect(result.input.prompt).toBe("Build a REST API with authentication");
      expect(result.input.workflow).toBe("review_plan");
      expect(result.input.models).toContain("anthropic/anthropic-model");
      expect(result.input.models).toContain("openai/openai-model");
      expect(result.input.synthesizer).toBe("anthropic/anthropic-model");
      expect(result.stages.drafts).toBe(pipelineResult.drafts);
      expect(result.stages.reviews).toBe(pipelineResult.reviews);
      expect(result.stages.synthesis).toBe(pipelineResult.synthesis);
      expect(result.stages.mapping).toBe(pipelineResult.mapping);
      expect(result.errors).toBe(pipelineResult.errors);
      expect(result.telemetry).toBe(pipelineResult.telemetry);
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

      const result = await reviewPlan(input);

      expect(result.status).toBe("failed");
      expect(result.stages.synthesis).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("API error");
      expect(result.pipeline).toBe(failedResult);
    });

    it("should use composite model IDs with model overrides", async () => {
      const p1 = createMockProvider("anthropic");
      p1.config.model = "claude-custom";
      const p2 = createMockProvider("openai");
      p2.config.model = "gpt-custom";
      const synth = createMockProvider("anthropic");
      synth.config.model = "claude-synth";

      const input: ReviewPlanInput = {
        plan: "Test plan",
        providers: [p1, p2],
        synthesizer: synth,
      };

      const result = await reviewPlan(input);

      expect(result.input.models).toContain("anthropic/claude-custom");
      expect(result.input.models).toContain("openai/gpt-custom");
      expect(result.input.synthesizer).toBe("anthropic/claude-synth");
    });
  });

  describe("onProgress passthrough", () => {
    it("should pass onProgress from ReviewPlanInput to PipelineConfig", async () => {
      const input = makeDefaultInput();
      const onProgress = vi.fn();
      input.onProgress = onProgress;
      await reviewPlan(input);

      expect(capturedConfig.onProgress).toBe(onProgress);
    });
  });

  describe("Call wiring completeness", () => {
    it("should pass providers, synthesizer, toolName, toolDescription, and schemas unchanged", async () => {
      const input = makeDefaultInput();
      await reviewPlan(input);

      expect(capturedConfig.providers).toBe(input.providers);
      expect(capturedConfig.synthesizer).toBe(input.synthesizer);
      expect(capturedConfig.review.toolName).toBe("submit_review");
      expect(capturedConfig.review.toolDescription).toBe("Submit your structured review of the responses");
      expect(capturedConfig.synthesis.toolName).toBe("submit_synthesis");
      expect(capturedConfig.synthesis.toolDescription).toBe("Submit your structured synthesis of the deliberation");
      expect(capturedConfig.review.schema).toBe(CROSS_REVIEW_SCHEMA);
      expect(capturedConfig.synthesis.schema).toBe(SYNTHESIS_RESPONSE_SCHEMA);
    });
  });
});
