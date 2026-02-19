import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "./orchestrator.js";
import type { Provider, ProviderConfig, DraftResponse, ProviderResult } from "../providers/types.js";
import type { CrossReview } from "../types/cross-review.js";
import type { SynthesisResponse } from "../types/synthesis-response.js";
import type { AnonymizedResponse } from "../types/anonymizer.js";
import type { PipelineEvent } from "../types/pipeline-event.js";
import type {
  PipelineConfig,
  ProviderWithConfig,
  ReviewPromptParams,
  SynthesisPromptParams,
  StagePromptConfig,
} from "../types/pipeline.js";

// --- Test helpers ---

function createMockProvider(id: string): ProviderWithConfig {
  return {
    provider: {
      meta: { id, name: id.charAt(0).toUpperCase() + id.slice(1), defaultModel: `${id}-model` },
      draft: vi.fn(),
      structuredOutput: vi.fn(),
      validateKey: vi.fn(),
    },
    config: { apiKey: `${id}-key` },
  };
}

function draftSuccess(content: string): ProviderResult<DraftResponse> {
  return {
    success: true,
    data: { content, model: "test-model", tokensIn: 10, tokensOut: 20, durationMs: 100 },
  };
}

function draftFailure(error: string): ProviderResult<DraftResponse> {
  return { success: false, error };
}

function reviewSuccess(overrides?: Partial<CrossReview>): ProviderResult<CrossReview> {
  return {
    success: true,
    data: {
      scores: [
        { response_id: "Response A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 },
      ],
      issues: [],
      disagreements: [],
      missing_info: [],
      confidence: 0.8,
      confidence_reason: "test",
      notes: "",
      ...overrides,
    },
  };
}

function reviewFailure(error: string): ProviderResult<CrossReview> {
  return { success: false, error };
}

function synthesisSuccess(overrides?: Partial<SynthesisResponse>): ProviderResult<SynthesisResponse> {
  return {
    success: true,
    data: {
      output: "Synthesized response",
      resolved_disagreements: [],
      open_questions: [],
      action_items: [],
      confidence: 0.9,
      confidence_reason: "test",
      ...overrides,
    },
  };
}

function synthesisFailure(error: string): ProviderResult<SynthesisResponse> {
  return { success: false, error };
}

function makeReviewConfig(): StagePromptConfig<ReviewPromptParams> {
  return {
    buildPrompt: vi.fn().mockReturnValue({ systemPrompt: "Review system", userPrompt: "Review user" }),
    schema: {},
    toolName: "submit_review",
    toolDescription: "Submit review",
  };
}

function makeSynthesisConfig(): StagePromptConfig<SynthesisPromptParams> {
  return {
    buildPrompt: vi.fn().mockReturnValue({ systemPrompt: "Synthesis system", userPrompt: "Synthesis user" }),
    schema: {},
    toolName: "submit_synthesis",
    toolDescription: "Submit synthesis",
  };
}

function buildHappyConfig(): {
  config: PipelineConfig;
  p1: ProviderWithConfig;
  p2: ProviderWithConfig;
  p3: ProviderWithConfig;
  synth: ProviderWithConfig;
} {
  const p1 = createMockProvider("anthropic");
  const p2 = createMockProvider("openai");
  const p3 = createMockProvider("google");
  const synth = createMockProvider("synthesizer");

  (p1.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftSuccess("Anthropic draft"));
  (p2.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftSuccess("OpenAI draft"));
  (p3.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftSuccess("Google draft"));

  (p1.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewSuccess());
  (p2.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewSuccess());
  (p3.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewSuccess());

  (synth.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(synthesisSuccess());

  const config: PipelineConfig = {
    prompt: "Test prompt",
    providers: [p1, p2, p3],
    synthesizer: synth,
    review: makeReviewConfig(),
    synthesis: makeSynthesisConfig(),
  };

  return { config, p1, p2, p3, synth };
}

// --- Tests ---

describe("orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path", () => {
    it("should return success when all 3 providers succeed", async () => {
      const { config } = buildHappyConfig();

      const result = await runPipeline(config);

      expect(result.status).toBe("success");
      expect(result.drafts.size).toBe(3);
      expect(result.reviews.size).toBe(3);
      expect(result.synthesis).not.toBeNull();
      expect(result.errors).toHaveLength(0);
      expect(result.mapping).not.toBeNull();

      for (const [, draft] of result.drafts) {
        expect(draft.status).toBe("success");
      }
      for (const [, review] of result.reviews) {
        expect(review.status).toBe("success");
      }
    });
  });

  describe("draft failures", () => {
    it("should continue with 2 providers when 1 of 3 drafts fails", async () => {
      const { config, p1 } = buildHappyConfig();
      (p1.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Anthropic down"));

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.get("anthropic")?.status).toBe("failed");
      expect(result.drafts.get("openai")?.status).toBe("success");
      expect(result.drafts.get("google")?.status).toBe("success");
      // Only 2 successful drafters → 2 reviewers
      expect(result.reviews.size).toBe(2);
      expect(result.synthesis).not.toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.stage).toBe("draft");
      expect(result.errors[0]!.model).toBe("anthropic");
    });

    it("should return failed when only 1 of 3 drafts succeeds", async () => {
      const { config, p1, p2 } = buildHappyConfig();
      (p1.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Fail 1"));
      (p2.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Fail 2"));

      const result = await runPipeline(config);

      expect(result.status).toBe("failed");
      expect(result.reviews.size).toBe(0);
      expect(result.synthesis).toBeNull();
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("should return failed when all 3 drafts fail", async () => {
      const { config, p1, p2, p3 } = buildHappyConfig();
      (p1.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Fail 1"));
      (p2.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Fail 2"));
      (p3.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Fail 3"));

      const result = await runPipeline(config);

      expect(result.status).toBe("failed");
      expect(result.drafts.size).toBe(3);
      expect(result.reviews.size).toBe(0);
      expect(result.synthesis).toBeNull();
      expect(result.errors).toHaveLength(3);
      for (const error of result.errors) {
        expect(error.stage).toBe("draft");
      }
    });
  });

  describe("review failures", () => {
    it("should still synthesize when 1 of 3 reviews fails", async () => {
      const { config, p1 } = buildHappyConfig();
      (p1.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewFailure("Review fail"));

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.reviews.get("anthropic")?.status).toBe("failed");
      expect(result.synthesis).not.toBeNull();
      const reviewErrors = result.errors.filter((e) => e.stage === "review");
      expect(reviewErrors).toHaveLength(1);
    });

    it("should skip synthesis when all reviews fail", async () => {
      const { config, p1, p2, p3 } = buildHappyConfig();
      (p1.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewFailure("Fail 1"));
      (p2.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewFailure("Fail 2"));
      (p3.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewFailure("Fail 3"));

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.size).toBe(3);
      expect(result.synthesis).toBeNull();
      // Synthesizer should not have been called
      const { synth } = buildHappyConfig();
      expect(config.synthesizer.provider.structuredOutput).not.toHaveBeenCalled();
    });
  });

  describe("synthesis failure", () => {
    it("should return partial with null synthesis when synthesizer fails", async () => {
      const { config } = buildHappyConfig();
      (config.synthesizer.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
        synthesisFailure("Synthesis fail"),
      );

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.size).toBe(3);
      expect(result.reviews.size).toBe(3);
      expect(result.synthesis).toBeNull();
      const synthErrors = result.errors.filter((e) => e.stage === "synthesis");
      expect(synthErrors).toHaveLength(1);
    });

    it("should handle synthesizer throwing an exception", async () => {
      const { config } = buildHappyConfig();
      (config.synthesizer.provider.structuredOutput as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("synth exploded");
      });

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.size).toBe(3);
      expect(result.reviews.size).toBe(3);
      expect(result.synthesis).toBeNull();
      expect(result.errors.some((e) => e.stage === "synthesis" && e.error.includes("synth exploded"))).toBe(
        true,
      );
    });
  });

  describe("anonymizer integration", () => {
    it("should exclude each reviewer's own response from their review input", async () => {
      const { config } = buildHappyConfig();
      const reviewBuildPrompt = config.review.buildPrompt as ReturnType<typeof vi.fn>;

      const result = await runPipeline(config);

      expect(result.status).toBe("success");
      expect(reviewBuildPrompt).toHaveBeenCalledTimes(3);

      // Each call should receive N-1 responses (2 out of 3)
      for (let i = 0; i < 3; i++) {
        const call = reviewBuildPrompt.mock.calls[i]![0] as ReviewPromptParams;
        expect(call.responses).toHaveLength(2);
        // All responses should be anonymized labels
        for (const resp of call.responses) {
          expect(resp.label).toMatch(/^Response [A-Z]$/);
        }
      }

      // Verify each reviewer saw different excluded responses
      // Collect all label sets seen by each reviewer
      const allLabelSets = reviewBuildPrompt.mock.calls.map(
        (call: [ReviewPromptParams]) => new Set(call[0].responses.map((r: AnonymizedResponse) => r.label)),
      );
      // With 3 reviewers each seeing 2 of 3 responses, at least one pair must differ
      const serialized = allLabelSets.map((s: Set<string>) => [...s].sort().join(","));
      const unique = new Set(serialized);
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe("data flow", () => {
    it("should pass all drafts and all successful reviews to the synthesizer", async () => {
      const { config } = buildHappyConfig();
      const synthBuildPrompt = config.synthesis.buildPrompt as ReturnType<typeof vi.fn>;

      const result = await runPipeline(config);

      expect(result.status).toBe("success");
      expect(synthBuildPrompt).toHaveBeenCalledTimes(1);

      const call = synthBuildPrompt.mock.calls[0]![0] as SynthesisPromptParams;
      expect(call.userPrompt).toBe("Test prompt");
      // Should receive all 3 anonymized drafts
      expect(call.drafts).toHaveLength(3);
      for (const draft of call.drafts) {
        expect(draft.label).toMatch(/^Response [A-Z]$/);
      }
      // Should receive all 3 successful reviews
      expect(call.reviews).toHaveLength(3);
      for (const { reviewerId, review } of call.reviews) {
        expect(typeof reviewerId).toBe("string");
        expect(review.confidence).toBe(0.8);
      }
    });
  });

  describe("provider throws (rejected promise)", () => {
    it("should handle a draft provider that rejects", async () => {
      const { config, p1 } = buildHappyConfig();
      (p1.provider.draft as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("SDK exploded"));

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.get("anthropic")?.status).toBe("failed");
      expect(result.drafts.get("openai")?.status).toBe("success");
      expect(result.drafts.get("google")?.status).toBe("success");
      expect(result.synthesis).not.toBeNull();
      expect(result.errors.some((e) => e.stage === "draft" && e.model === "anthropic")).toBe(true);
    });

    it("should handle a review provider that rejects", async () => {
      const { config, p2 } = buildHappyConfig();
      (p2.provider.structuredOutput as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Review SDK crash"),
      );

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.reviews.get("openai")?.status).toBe("failed");
      expect(result.synthesis).not.toBeNull();
      expect(result.errors.some((e) => e.stage === "review" && e.model === "openai")).toBe(true);
    });
  });

  describe("provider throws (synchronous)", () => {
    it("should handle a draft provider that throws synchronously", async () => {
      const { config, p1 } = buildHappyConfig();
      (p1.provider.draft as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("sync boom");
      });

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.get("anthropic")?.status).toBe("failed");
      expect(result.synthesis).not.toBeNull();
      expect(result.errors.some((e) => e.stage === "draft" && e.model === "anthropic")).toBe(true);
    });

    it("should handle a review provider that throws synchronously", async () => {
      const { config, p2 } = buildHappyConfig();
      (p2.provider.structuredOutput as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("sync review boom");
      });

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.reviews.get("openai")?.status).toBe("failed");
      expect(result.synthesis).not.toBeNull();
      expect(result.errors.some((e) => e.stage === "review" && e.model === "openai")).toBe(true);
    });
  });

  describe("buildPrompt throws", () => {
    it("should handle review buildPrompt throwing", async () => {
      const { config } = buildHappyConfig();
      (config.review.buildPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("prompt boom");
      });

      const result = await runPipeline(config);

      // All reviews fail because buildPrompt throws for each
      expect(result.status).toBe("partial");
      expect(result.synthesis).toBeNull();
      for (const [, review] of result.reviews) {
        expect(review.status).toBe("failed");
      }
      expect(result.errors.some((e) => e.stage === "review")).toBe(true);
    });

    it("should handle synthesis buildPrompt throwing", async () => {
      const { config } = buildHappyConfig();
      (config.synthesis.buildPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("synth prompt boom");
      });

      const result = await runPipeline(config);

      expect(result.status).toBe("partial");
      expect(result.drafts.size).toBe(3);
      expect(result.reviews.size).toBe(3);
      expect(result.synthesis).toBeNull();
      expect(result.errors.some((e) => e.stage === "synthesis" && e.error.includes("synth prompt boom"))).toBe(
        true,
      );
    });
  });

  describe("sanitize failure paths", () => {
    it("should mark review as failed when sanitizeReview throws (vacuous review)", async () => {
      const { config, p1 } = buildHappyConfig();
      // Return a vacuous review: empty scores, empty issues, empty disagreements
      (p1.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
        reviewSuccess({ scores: [], issues: [], disagreements: [] }),
      );

      const result = await runPipeline(config);

      expect(result.reviews.get("anthropic")?.status).toBe("failed");
      expect(result.errors.some((e) => e.stage === "review" && e.model === "anthropic" && e.error.includes("vacuous"))).toBe(true);
      // Other reviews should still succeed
      expect(result.reviews.get("openai")?.status).toBe("success");
      expect(result.reviews.get("google")?.status).toBe("success");
      // Synthesis should still run (2 successful reviews remain)
      expect(result.synthesis).not.toBeNull();
    });

    it("should emit review:failed event when sanitizeReview throws", async () => {
      const { config, p1 } = buildHappyConfig();
      (p1.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
        reviewSuccess({ scores: [], issues: [], disagreements: [] }),
      );

      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const reviewFailed = events.filter((e) => e.stage === "review" && e.status === "failed");
      expect(reviewFailed).toHaveLength(1);
      expect(reviewFailed[0]!.model).toBe("anthropic");
    });

    it("should return null synthesis when sanitizeSynthesis throws (empty output)", async () => {
      const { config } = buildHappyConfig();
      (config.synthesizer.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
        synthesisSuccess({ output: "" }),
      );

      const result = await runPipeline(config);

      expect(result.synthesis).toBeNull();
      expect(result.status).toBe("partial");
      expect(result.errors.some((e) => e.stage === "synthesis" && e.error.includes("empty or missing"))).toBe(true);
    });

    it("should emit synthesis:failed event when sanitizeSynthesis throws", async () => {
      const { config } = buildHappyConfig();
      (config.synthesizer.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
        synthesisSuccess({ output: null as unknown as string }),
      );

      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const synthFailed = events.filter((e) => e.stage === "synthesis" && e.status === "failed");
      expect(synthFailed).toHaveLength(1);
    });
  });

  describe("config validation", () => {
    it("should return failed when 0 providers given", async () => {
      const config: PipelineConfig = {
        prompt: "Test",
        providers: [],
        synthesizer: createMockProvider("synth"),
        review: makeReviewConfig(),
        synthesis: makeSynthesisConfig(),
      };

      const result = await runPipeline(config);

      expect(result.status).toBe("failed");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toContain("At least 2 providers required");
    });

    it("should return failed when 1 provider given", async () => {
      const config: PipelineConfig = {
        prompt: "Test",
        providers: [createMockProvider("solo")],
        synthesizer: createMockProvider("synth"),
        review: makeReviewConfig(),
        synthesis: makeSynthesisConfig(),
      };

      const result = await runPipeline(config);

      expect(result.status).toBe("failed");
      expect(result.errors[0]!.error).toContain("At least 2 providers required");
    });

    it("should return failed when duplicate provider IDs given", async () => {
      const config: PipelineConfig = {
        prompt: "Test",
        providers: [createMockProvider("openai"), createMockProvider("openai"), createMockProvider("google")],
        synthesizer: createMockProvider("synth"),
        review: makeReviewConfig(),
        synthesis: makeSynthesisConfig(),
      };

      const result = await runPipeline(config);

      expect(result.status).toBe("failed");
      expect(result.errors[0]!.error).toContain("Duplicate provider ID");
    });
  });

  describe("onProgress events", () => {
    it("should emit draft:started for each provider", async () => {
      const { config } = buildHappyConfig();
      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const draftStarted = events.filter((e) => e.stage === "draft" && e.status === "started");
      expect(draftStarted).toHaveLength(3);
      const models = draftStarted.map((e) => e.model);
      expect(models).toContain("anthropic");
      expect(models).toContain("openai");
      expect(models).toContain("google");
    });

    it("should emit draft:complete with response content for successful drafts", async () => {
      const { config } = buildHappyConfig();
      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const draftComplete = events.filter((e) => e.stage === "draft" && e.status === "complete");
      expect(draftComplete).toHaveLength(3);
      for (const event of draftComplete) {
        if (event.stage === "draft" && event.status === "complete") {
          expect(typeof event.response).toBe("string");
          expect(event.response.length).toBeGreaterThan(0);
        }
      }
    });

    it("should emit draft:failed with error for failed drafts", async () => {
      const { config, p1, p2 } = buildHappyConfig();
      (p1.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("Anthropic down"));
      (p2.provider.draft as ReturnType<typeof vi.fn>).mockResolvedValue(draftFailure("OpenAI down"));

      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const draftFailed = events.filter((e) => e.stage === "draft" && e.status === "failed");
      expect(draftFailed).toHaveLength(2);
      const failedModels = draftFailed.map((e) => e.model);
      expect(failedModels).toContain("anthropic");
      expect(failedModels).toContain("openai");
      for (const event of draftFailed) {
        if (event.stage === "draft" && event.status === "failed") {
          expect(typeof event.error).toBe("string");
        }
      }
    });

    it("should emit review:started and review:complete for successful reviews", async () => {
      const { config } = buildHappyConfig();
      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const reviewStarted = events.filter((e) => e.stage === "review" && e.status === "started");
      const reviewComplete = events.filter((e) => e.stage === "review" && e.status === "complete");
      expect(reviewStarted).toHaveLength(3);
      expect(reviewComplete).toHaveLength(3);
      for (const event of reviewComplete) {
        if (event.stage === "review" && event.status === "complete") {
          expect(event.review).toBeDefined();
          expect(event.review.confidence).toBe(0.8);
        }
      }
    });

    it("should emit review:failed for failed reviews", async () => {
      const { config, p1 } = buildHappyConfig();
      (p1.provider.structuredOutput as ReturnType<typeof vi.fn>).mockResolvedValue(reviewFailure("Review fail"));

      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const reviewFailed = events.filter((e) => e.stage === "review" && e.status === "failed");
      expect(reviewFailed).toHaveLength(1);
      expect(reviewFailed[0]!.model).toBe("anthropic");
    });

    it("should emit synthesis:started and synthesis:complete", async () => {
      const { config } = buildHappyConfig();
      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      const synthStarted = events.filter((e) => e.stage === "synthesis" && e.status === "started");
      const synthComplete = events.filter((e) => e.stage === "synthesis" && e.status === "complete");
      expect(synthStarted).toHaveLength(1);
      expect(synthComplete).toHaveLength(1);
      if (synthComplete[0]!.stage === "synthesis" && synthComplete[0]!.status === "complete") {
        expect(synthComplete[0]!.result.output).toBe("Synthesized response");
      }
    });

    it("should emit events in stage monotonic order", async () => {
      const { config } = buildHappyConfig();
      const events: PipelineEvent[] = [];
      config.onProgress = (e) => events.push(e);

      await runPipeline(config);

      // Verify monotonicity: all draft events before any review, all review before synthesis
      const stageOrder = ["draft", "review", "synthesis"];
      let lastStageIdx = 0;
      for (const event of events) {
        const idx = stageOrder.indexOf(event.stage);
        expect(idx).toBeGreaterThanOrEqual(lastStageIdx);
        if (idx > lastStageIdx) lastStageIdx = idx;
      }
      // Ensure we saw all three stages
      expect(lastStageIdx).toBe(2);
    });

    it("should not break when onProgress is not provided", async () => {
      const { config } = buildHappyConfig();
      delete config.onProgress;

      const result = await runPipeline(config);

      expect(result.status).toBe("success");
      expect(result.drafts.size).toBe(3);
      expect(result.synthesis).not.toBeNull();
    });

    it("should isolate callback failures from pipeline execution", async () => {
      const { config } = buildHappyConfig();
      config.onProgress = () => {
        throw new Error("callback exploded");
      };

      const result = await runPipeline(config);

      // Pipeline should still succeed despite callback throwing on every event
      expect(result.status).toBe("success");
      expect(result.drafts.size).toBe(3);
      expect(result.reviews.size).toBe(3);
      expect(result.synthesis).not.toBeNull();
    });
  });
});
