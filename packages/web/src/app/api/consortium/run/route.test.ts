import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReviewPlanInput, WorkflowResult, PipelineEvent } from "@llmtium/core";

vi.mock("@llmtium/core", () => ({
  anthropicProvider: {
    meta: { id: "anthropic", name: "Anthropic", defaultModel: "claude-model" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  openaiProvider: {
    meta: { id: "openai", name: "OpenAI", defaultModel: "gpt-model" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  googleProvider: {
    meta: { id: "google", name: "Google", defaultModel: "gemini-model" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  reviewPlan: vi.fn(),
}));

import { reviewPlan } from "@llmtium/core";
import { POST } from "./route.js";

const mockReviewPlan = reviewPlan as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/consortium/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    prompt: "Review my plan",
    models: ["anthropic", "openai"],
    synthesizer: "anthropic",
    apiKeys: { anthropic: "sk-ant-secret", openai: "sk-oai-secret" },
  };
}

function mockWorkflowResult(): WorkflowResult {
  return {
    status: "success",
    input: { prompt: "Test", workflow: "review_plan", models: ["anthropic/claude"], synthesizer: "anthropic/claude" },
    stages: {
      drafts: new Map([["anthropic", { status: "success" as const, response: { content: "Draft", model: "claude", tokensIn: 10, tokensOut: 20, durationMs: 100 } }]]),
      reviews: new Map([["anthropic", { status: "success" as const, review: { scores: {}, issues: [], disagreements: [], missing_info: [], confidence: 0.8, confidence_reason: "test" } }]]),
      synthesis: { output: "Synthesized", resolved_disagreements: [], open_questions: [], action_items: [], confidence: 0.9, confidence_reason: "good" },
      mapping: new Map([["Response A", "anthropic"]]),
    },
    errors: [],
    telemetry: { totalDurationMs: 500, stageDurationMs: { draft: 200, review: 200, synthesis: 100 }, draftTokens: {} },
    pipeline: {
      status: "success",
      drafts: new Map([["anthropic", { status: "success" as const, response: { content: "Draft", model: "claude", tokensIn: 10, tokensOut: 20, durationMs: 100 } }]]),
      reviews: new Map([["anthropic", { status: "success" as const, review: { scores: {}, issues: [], disagreements: [], missing_info: [], confidence: 0.8, confidence_reason: "test" } }]]),
      synthesis: { output: "Synthesized", resolved_disagreements: [], open_questions: [], action_items: [], confidence: 0.9, confidence_reason: "good" },
      mapping: new Map([["Response A", "anthropic"]]),
      errors: [],
      telemetry: { totalDurationMs: 500, stageDurationMs: { draft: 200, review: 200, synthesis: 100 }, draftTokens: {} },
    },
  };
}

async function readSSEEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as Record<string, unknown>);
}

describe("POST /api/consortium/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return SSE headers", async () => {
    mockReviewPlan.mockResolvedValue(mockWorkflowResult());
    const response = await POST(makeRequest(validBody()));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    // Drain body to avoid hanging
    await response.text();
  });

  it("should stream pipeline events emitted via onProgress", async () => {
    mockReviewPlan.mockImplementation(async (input: ReviewPlanInput) => {
      input.onProgress?.({ stage: "draft", model: "anthropic", status: "started" });
      input.onProgress?.({ stage: "draft", model: "anthropic", status: "complete", response: "Draft A" });
      input.onProgress?.({ stage: "review", model: "anthropic", status: "started" });
      input.onProgress?.({ stage: "review", model: "anthropic", status: "complete", review: { scores: {}, issues: [], disagreements: [], missing_info: [], confidence: 0.8, confidence_reason: "test" } });
      input.onProgress?.({ stage: "synthesis", model: "anthropic", status: "started" });
      input.onProgress?.({ stage: "synthesis", status: "complete", result: { output: "Synthesized", resolved_disagreements: [], open_questions: [], action_items: [], confidence: 0.9, confidence_reason: "good" } });
      return mockWorkflowResult();
    });

    const response = await POST(makeRequest(validBody()));
    const events = await readSSEEvents(response);

    // Assert stage monotonicity: draft events before review, review before synthesis
    const stages = events.map((e) => e.stage as string);
    let lastDraft = -1;
    let firstReview = stages.length;
    let lastReview = -1;
    let firstSynthesis = stages.length;
    for (let i = 0; i < stages.length; i++) {
      if (stages[i] === "draft") lastDraft = i;
      if (stages[i] === "review" && i < firstReview) firstReview = i;
      if (stages[i] === "review") lastReview = i;
      if (stages[i] === "synthesis" && i < firstSynthesis) firstSynthesis = i;
    }
    expect(lastDraft).toBeLessThan(firstReview);
    expect(lastReview).toBeLessThan(firstSynthesis);

    // Assert required events present
    expect(events.some((e) => e.stage === "draft" && e.status === "started")).toBe(true);
    expect(events.some((e) => e.stage === "draft" && e.status === "complete")).toBe(true);
    expect(events.some((e) => e.stage === "synthesis" && e.status === "complete")).toBe(true);
  });

  it("should return 400 for invalid request body", async () => {
    const response = await POST(makeRequest({ prompt: "" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("should not include API keys in any SSE event payload", async () => {
    const body = validBody();

    mockReviewPlan.mockImplementation(async (input: ReviewPlanInput) => {
      input.onProgress?.({ stage: "draft", model: "anthropic", status: "started" });
      input.onProgress?.({ stage: "draft", model: "anthropic", status: "complete", response: "Safe content" });
      return mockWorkflowResult();
    });

    const response = await POST(makeRequest(body));
    const fullText = await response.text();

    // API keys should never appear in the SSE stream
    expect(fullText).not.toContain("sk-ant-secret");
    expect(fullText).not.toContain("sk-oai-secret");
  });

  it("should send done event as the last event with serialized result", async () => {
    mockReviewPlan.mockImplementation(async (input: ReviewPlanInput) => {
      input.onProgress?.({ stage: "draft", model: "anthropic", status: "started" });
      return mockWorkflowResult();
    });

    const response = await POST(makeRequest(validBody()));
    const events = await readSSEEvents(response);
    const lastEvent = events[events.length - 1]!;

    expect(lastEvent.stage).toBe("done");
    expect(lastEvent.status).toBe("complete");
    expect(lastEvent.result).toBeDefined();

    // Serialized result should not contain Map objects — verify via JSON round-trip
    const resultJson = JSON.stringify(lastEvent.result);
    const parsed = JSON.parse(resultJson);
    expect(parsed.status).toBe("success");
    expect(parsed.stages.drafts.anthropic).toBeDefined();
  });

  it("should handle pipeline errors gracefully and close stream", async () => {
    mockReviewPlan.mockImplementation(async (input: ReviewPlanInput) => {
      input.onProgress?.({ stage: "draft", model: "anthropic", status: "started" });
      throw new Error("Pipeline exploded");
    });

    const response = await POST(makeRequest(validBody()));
    const events = await readSSEEvents(response);

    // Should have at least the draft:started event and a done event
    expect(events.length).toBeGreaterThanOrEqual(2);
    const lastEvent = events[events.length - 1]!;
    expect(lastEvent.stage).toBe("done");
    expect(lastEvent.status).toBe("error");
    expect(lastEvent.error).toContain("Pipeline exploded");
  });
});
