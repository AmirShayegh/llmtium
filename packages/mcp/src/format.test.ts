import { describe, it, expect } from "vitest";
import { formatWorkflowResult } from "./format.js";
import type {
  WorkflowResult,
  SynthesisResponse,
  DraftResponse,
  CrossReview,
  PipelineResult,
} from "@llmtium/core";

function makeDraftResponse(overrides?: Partial<DraftResponse>): DraftResponse {
  return {
    content: "Draft content",
    model: "test-model",
    tokensIn: 100,
    tokensOut: 200,
    durationMs: 500,
    ...overrides,
  };
}

function makeSynthesis(overrides?: Partial<SynthesisResponse>): SynthesisResponse {
  return {
    output: "The synthesized recommendation is to use PostgreSQL with a phased rollout.",
    resolved_disagreements: [
      {
        topic: "Database choice",
        chosen_position: "PostgreSQL",
        rationale: "Better scalability for production",
        supporting_responses: ["Response A", "Response C"],
      },
    ],
    open_questions: ["What is the expected query volume?"],
    action_items: [
      { priority: "P0", item: "Set up PostgreSQL cluster" },
      { priority: "P1", item: "Write migration scripts" },
      { priority: "P2", item: "Update documentation" },
    ],
    confidence: 0.92,
    confidence_reason: "Strong consensus with minor gaps",
    ...overrides,
  };
}

function makeReview(): CrossReview {
  return {
    scores: { "Response A": { correctness: 4, completeness: 3, actionability: 5, clarity: 4 } },
    issues: ["Lacks error handling"],
    disagreements: [],
    missing_info: [],
    confidence: 0.85,
    confidence_reason: "Mostly aligned",
  };
}

function makePipelineResult(overrides?: Partial<PipelineResult>): PipelineResult {
  return {
    status: "success",
    drafts: new Map([
      ["anthropic", { status: "success" as const, response: makeDraftResponse() }],
      ["openai", { status: "success" as const, response: makeDraftResponse({ model: "gpt-4o" }) }],
    ]),
    reviews: new Map([
      ["anthropic", { status: "success" as const, review: makeReview() }],
      ["openai", { status: "success" as const, review: makeReview() }],
    ]),
    synthesis: makeSynthesis(),
    mapping: new Map([["Response A", "anthropic"], ["Response B", "openai"]]),
    errors: [],
    telemetry: {
      totalDurationMs: 12345,
      stageDurationMs: { draft: 4000, review: 6000, synthesis: 2345 },
      draftTokens: {
        anthropic: { tokensIn: 100, tokensOut: 200 },
        openai: { tokensIn: 130, tokensOut: 380 },
      },
    },
    ...overrides,
  };
}

function makeWorkflowResult(overrides?: Partial<WorkflowResult>): WorkflowResult {
  const pipeline = makePipelineResult(overrides?.pipeline ? overrides.pipeline as Partial<PipelineResult> : undefined);
  return {
    status: pipeline.status as WorkflowResult["status"],
    input: {
      prompt: "Review my deployment plan",
      workflow: "review_plan",
      models: ["anthropic", "openai"],
      synthesizer: "anthropic",
    },
    stages: {
      drafts: pipeline.drafts,
      reviews: pipeline.reviews,
      synthesis: pipeline.synthesis,
      mapping: pipeline.mapping,
    },
    errors: pipeline.errors,
    telemetry: pipeline.telemetry,
    pipeline,
    ...overrides,
  };
}

describe("formatWorkflowResult", () => {
  it("should include synthesis output as main section", () => {
    const text = formatWorkflowResult(makeWorkflowResult());
    expect(text).toContain("SYNTHESIS");
    expect(text).toContain("The synthesized recommendation is to use PostgreSQL with a phased rollout.");
  });

  it("should include resolved disagreements with topics and rationale", () => {
    const text = formatWorkflowResult(makeWorkflowResult());
    expect(text).toContain("RESOLVED DISAGREEMENTS");
    expect(text).toContain("Database choice");
    expect(text).toContain("PostgreSQL");
    expect(text).toContain("Better scalability for production");
    expect(text).toContain("Response A");
    expect(text).toContain("Response C");
  });

  it("should include open questions", () => {
    const text = formatWorkflowResult(makeWorkflowResult());
    expect(text).toContain("OPEN QUESTIONS");
    expect(text).toContain("What is the expected query volume?");
  });

  it("should include action items with priorities", () => {
    const text = formatWorkflowResult(makeWorkflowResult());
    expect(text).toContain("ACTION ITEMS");
    expect(text).toContain("[P0]");
    expect(text).toContain("Set up PostgreSQL cluster");
    expect(text).toContain("[P1]");
    expect(text).toContain("Write migration scripts");
    expect(text).toContain("[P2]");
    expect(text).toContain("Update documentation");
  });

  it("should include confidence with reason", () => {
    const text = formatWorkflowResult(makeWorkflowResult());
    expect(text).toContain("CONFIDENCE");
    expect(text).toContain("0.92");
    expect(text).toContain("Strong consensus with minor gaps");
  });

  it("should include telemetry duration", () => {
    const text = formatWorkflowResult(makeWorkflowResult());
    expect(text).toContain("TELEMETRY");
    expect(text).toContain("12.3s");
  });

  it("should omit resolved disagreements section when empty", () => {
    const result = makeWorkflowResult();
    result.stages.synthesis = makeSynthesis({ resolved_disagreements: [] });
    result.pipeline = makePipelineResult({ synthesis: result.stages.synthesis });
    const text = formatWorkflowResult(result);
    expect(text).not.toContain("RESOLVED DISAGREEMENTS");
  });

  it("should omit open questions section when empty", () => {
    const result = makeWorkflowResult();
    result.stages.synthesis = makeSynthesis({ open_questions: [] });
    result.pipeline = makePipelineResult({ synthesis: result.stages.synthesis });
    const text = formatWorkflowResult(result);
    expect(text).not.toContain("OPEN QUESTIONS");
  });

  it("should omit action items section when empty", () => {
    const result = makeWorkflowResult();
    result.stages.synthesis = makeSynthesis({ action_items: [] });
    result.pipeline = makePipelineResult({ synthesis: result.stages.synthesis });
    const text = formatWorkflowResult(result);
    expect(text).not.toContain("ACTION ITEMS");
  });

  it("should include warnings section for partial results", () => {
    const result = makeWorkflowResult({
      status: "partial",
      errors: [{ stage: "draft", model: "google", error: "Rate limit exceeded" }],
      pipeline: makePipelineResult({
        status: "partial",
        errors: [{ stage: "draft", model: "google", error: "Rate limit exceeded" }],
      }),
    });
    const text = formatWorkflowResult(result);
    expect(text).toContain("WARNINGS");
    expect(text).toContain("draft");
    expect(text).toContain("google");
    expect(text).toContain("Rate limit exceeded");
  });

  it("should show fallback message when partial result has null synthesis", () => {
    const result = makeWorkflowResult({
      status: "partial",
      errors: [{ stage: "synthesis", model: "anthropic", error: "Failed" }],
      pipeline: makePipelineResult({
        status: "partial",
        synthesis: null,
        errors: [{ stage: "synthesis", model: "anthropic", error: "Failed" }],
      }),
    });
    result.stages.synthesis = null;
    const text = formatWorkflowResult(result);
    expect(text).toContain("No synthesis was produced");
  });

  it("should show error details for failed results", () => {
    const result = makeWorkflowResult({
      status: "failed",
      errors: [
        { stage: "draft", model: "anthropic", error: "API error" },
        { stage: "draft", model: "openai", error: "Timeout" },
      ],
      pipeline: makePipelineResult({
        status: "failed",
        synthesis: null,
        errors: [
          { stage: "draft", model: "anthropic", error: "API error" },
          { stage: "draft", model: "openai", error: "Timeout" },
        ],
      }),
    });
    result.stages.synthesis = null;
    const text = formatWorkflowResult(result);
    expect(text).toContain("API error");
    expect(text).toContain("Timeout");
    expect(text).toContain("anthropic");
    expect(text).toContain("openai");
    expect(text).not.toContain("SYNTHESIS");
  });
});
