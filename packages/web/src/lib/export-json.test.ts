import { describe, it, expect } from "vitest";
import { exportToJson } from "./export-json";
import type { ExportData } from "./export-json";
import type { CrossReview, SynthesisResponse } from "@llmtium/core";
import type { SerializedWorkflowResult } from "./serialize";

function makeFixture(): ExportData {
  const review: CrossReview = {
    scores: [
      { response_id: "Response A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 },
    ],
    issues: ["Minor issue"],
    disagreements: [],
    missing_info: [],
    confidence: 0.8,
    confidence_reason: "High agreement",
    notes: "",
  };

  const synthesis: SynthesisResponse = {
    output: "Synthesized output text",
    resolved_disagreements: [],
    open_questions: ["What about edge cases?"],
    action_items: [{ priority: "P0", item: "Fix the bug" }],
    confidence: 0.9,
    confidence_reason: "Strong consensus",
  };

  const result: SerializedWorkflowResult = {
    status: "success",
    input: {
      prompt: "Test prompt",
      workflow: "review_plan",
      models: ["anthropic", "openai"],
      synthesizer: "anthropic",
    },
    stages: {
      drafts: { anthropic: { content: "Draft A", model: "claude-opus-4-6", tokensIn: 100, tokensOut: 200, durationMs: 1000 } },
      reviews: { anthropic: review },
      synthesis,
      mapping: { "Response A": "anthropic", "Response B": "openai" },
    },
    errors: [],
    telemetry: {
      totalDurationMs: 5000,
      stageDurationMs: { draft: 2000, review: 2000, synthesis: 1000 },
      draftTokens: { anthropic: { tokensIn: 100, tokensOut: 200 }, openai: { tokensIn: 80, tokensOut: 150 } },
    },
    pipeline: {
      status: "success",
      drafts: { anthropic: { content: "Draft A" }, openai: { content: "Draft B" } },
      reviews: { anthropic: review },
      synthesis,
      mapping: { "Response A": "anthropic", "Response B": "openai" },
      errors: [],
      telemetry: {
        totalDurationMs: 5000,
        stageDurationMs: { draft: 2000, review: 2000, synthesis: 1000 },
        draftTokens: { anthropic: { tokensIn: 100, tokensOut: 200 }, openai: { tokensIn: 80, tokensOut: 150 } },
      },
    },
  };

  return {
    prompt: "Test prompt",
    models: ["anthropic", "openai"],
    synthesizer: "anthropic",
    drafts: { anthropic: "Draft A", openai: "Draft B" },
    reviews: { anthropic: review },
    synthesis,
    mapping: { "Response A": "anthropic", "Response B": "openai" },
    result,
    errors: [],
  };
}

describe("exportToJson", () => {
  it("should contain generator header in _meta", () => {
    const json = exportToJson(makeFixture());
    const parsed = JSON.parse(json);
    expect(parsed._meta.generator).toBe("LLMtium \u2014 Multi-LLM Deliberation Tool");
  });

  it("should contain the original prompt at top level", () => {
    const json = exportToJson(makeFixture());
    const parsed = JSON.parse(json);
    expect(parsed.prompt).toBe("Test prompt");
  });

  it("should contain pipeline key with pipeline data, not full result envelope", () => {
    const json = exportToJson(makeFixture());
    const parsed = JSON.parse(json);
    expect(parsed.pipeline).toBeDefined();
    expect(parsed.result).toBeUndefined();
    expect(parsed.pipeline.drafts).toBeDefined();
    expect(parsed.pipeline.reviews).toBeDefined();
    expect(parsed.pipeline.synthesis).toBeDefined();
    expect(parsed.pipeline.telemetry).toBeDefined();
  });
});
