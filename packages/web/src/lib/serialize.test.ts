import { describe, it, expect } from "vitest";
import { serializeWorkflowResult } from "./serialize.js";
import type { WorkflowResult } from "@llmtium/core";

function makeWorkflowResult(overrides?: Partial<WorkflowResult>): WorkflowResult {
  return {
    status: "success",
    input: {
      prompt: "Test",
      workflow: "review_plan",
      models: ["anthropic/claude"],
      synthesizer: "anthropic/claude",
    },
    stages: {
      drafts: new Map([
        ["anthropic", { status: "success" as const, response: { content: "Draft A", model: "claude", tokensIn: 10, tokensOut: 20, durationMs: 100 } }],
        ["openai", { status: "failed" as const, error: "timeout" }],
      ]),
      reviews: new Map([
        ["anthropic", { status: "success" as const, review: { scores: {}, issues: [], disagreements: [], missing_info: [], confidence: 0.8, confidence_reason: "test" } }],
      ]),
      synthesis: {
        output: "Synthesized",
        resolved_disagreements: [],
        open_questions: [],
        action_items: [],
        confidence: 0.9,
        confidence_reason: "good",
      },
      mapping: new Map([["Response A", "anthropic"], ["Response B", "openai"]]),
    },
    errors: [],
    telemetry: { totalDurationMs: 500, stageDurationMs: { draft: 200, review: 200, synthesis: 100 }, draftTokens: {} },
    pipeline: {
      status: "success",
      drafts: new Map([
        ["anthropic", { status: "success" as const, response: { content: "Draft A", model: "claude", tokensIn: 10, tokensOut: 20, durationMs: 100 } }],
      ]),
      reviews: new Map([
        ["anthropic", { status: "success" as const, review: { scores: {}, issues: [], disagreements: [], missing_info: [], confidence: 0.8, confidence_reason: "test" } }],
      ]),
      synthesis: { output: "Synthesized", resolved_disagreements: [], open_questions: [], action_items: [], confidence: 0.9, confidence_reason: "good" },
      mapping: new Map([["Response A", "anthropic"]]),
      errors: [],
      telemetry: { totalDurationMs: 500, stageDurationMs: { draft: 200, review: 200, synthesis: 100 }, draftTokens: {} },
    },
    ...overrides,
  };
}

describe("serializeWorkflowResult", () => {
  it("should convert all Maps to plain objects", () => {
    const result = makeWorkflowResult();
    const serialized = serializeWorkflowResult(result);

    // Top-level stages
    expect(serialized.stages.drafts).not.toBeInstanceOf(Map);
    expect(serialized.stages.drafts["anthropic"]).toBeDefined();
    expect(serialized.stages.drafts["openai"]).toBeDefined();
    expect(serialized.stages.reviews).not.toBeInstanceOf(Map);
    expect(serialized.stages.reviews["anthropic"]).toBeDefined();
    expect(serialized.stages.mapping).not.toBeInstanceOf(Map);
    expect(serialized.stages.mapping["Response A"]).toBe("anthropic");

    // Nested pipeline Maps
    expect(serialized.pipeline.drafts).not.toBeInstanceOf(Map);
    expect(serialized.pipeline.drafts["anthropic"]).toBeDefined();
    expect(serialized.pipeline.reviews).not.toBeInstanceOf(Map);
    expect(serialized.pipeline.mapping).not.toBeInstanceOf(Map);
    expect(serialized.pipeline.mapping["Response A"]).toBe("anthropic");
  });

  it("should produce valid JSON", () => {
    const result = makeWorkflowResult();
    const serialized = serializeWorkflowResult(result);

    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    expect(parsed.status).toBe("success");
    expect(parsed.stages.drafts.anthropic.status).toBe("success");
    expect(parsed.stages.mapping["Response A"]).toBe("anthropic");
  });

  it("should handle null synthesis and null mapping", () => {
    const result = makeWorkflowResult({
      stages: {
        drafts: new Map(),
        reviews: new Map(),
        synthesis: null,
        mapping: null,
      },
      pipeline: {
        status: "failed",
        drafts: new Map(),
        reviews: new Map(),
        synthesis: null,
        mapping: null,
        errors: [{ stage: "draft", model: "test", error: "fail" }],
        telemetry: { totalDurationMs: 0, stageDurationMs: { draft: 0, review: 0, synthesis: 0 }, draftTokens: {} },
      },
    });

    const serialized = serializeWorkflowResult(result);

    expect(serialized.stages.synthesis).toBeNull();
    expect(serialized.stages.mapping).toBeNull();
    expect(serialized.pipeline.synthesis).toBeNull();
    expect(serialized.pipeline.mapping).toBeNull();

    const json = JSON.stringify(serialized);
    expect(json).toContain('"synthesis":null');
  });
});
