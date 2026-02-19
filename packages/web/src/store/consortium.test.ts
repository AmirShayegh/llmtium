import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StoreApi } from "zustand";
import { createConsortiumStore } from "./consortium";
import type { ConsortiumState } from "./consortium";
import type { CrossReview, SynthesisResponse } from "@llmtium/core";

function makeCrossReview(overrides?: Partial<CrossReview>): CrossReview {
  return {
    scores: [
      { response_id: "Response A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 },
    ],
    issues: ["Minor issue"],
    disagreements: [],
    missing_info: [],
    confidence: 0.8,
    confidence_reason: "High agreement",
    notes: "",
    ...overrides,
  };
}

function makeSynthesisResponse(overrides?: Partial<SynthesisResponse>): SynthesisResponse {
  return {
    output: "Synthesized output text",
    resolved_disagreements: [],
    open_questions: [],
    action_items: [],
    confidence: 0.9,
    confidence_reason: "Strong consensus",
    ...overrides,
  };
}

describe("consortium store", () => {
  let store: StoreApi<ConsortiumState>;

  beforeEach(() => {
    store = createConsortiumStore();
  });

  it("should initialize with idle status, general workflow, and empty state", () => {
    const state = store.getState();
    expect(state.runStatus).toBe("idle");
    expect(state.workflow).toBe("general");
    expect(state.models).toEqual([]);
    expect(state.drafts).toEqual({});
    expect(state.reviews).toEqual({});
    expect(state.synthesis).toBeNull();
    expect(state.mapping).toBeNull();
    expect(state.result).toBeNull();
    expect(state.errors).toEqual([]);
    expect(state.errorMessage).toBeNull();
    expect(state.stages.draft.status).toBe("pending");
    expect(state.stages.review.status).toBe("pending");
    expect(state.stages.synthesis.status).toBe("pending");
  });

  it("should update workflow via setWorkflow", () => {
    expect(store.getState().workflow).toBe("general");
    store.getState().setWorkflow("review_plan");
    expect(store.getState().workflow).toBe("review_plan");
    store.getState().setWorkflow("general");
    expect(store.getState().workflow).toBe("general");
  });

  describe("handleEvent: draft stage", () => {
    beforeEach(() => {
      // Simulate startRun initialization
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai", "google"],
        stages: {
          draft: { status: "pending", models: {}, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });
    });

    it("should set draft stage to running on draft:started", () => {
      store.getState().handleEvent({
        stage: "draft", model: "anthropic", status: "started",
      });

      const state = store.getState();
      expect(state.stages.draft.status).toBe("running");
      expect(state.stages.draft.models.anthropic).toBe("running");
    });

    it("should store response text on draft:complete", () => {
      store.getState().handleEvent({
        stage: "draft", model: "anthropic", status: "complete", response: "Draft text here",
      });

      const state = store.getState();
      expect(state.stages.draft.models.anthropic).toBe("complete");
      expect(state.drafts.anthropic).toBe("Draft text here");
    });

    it("should set model to failed on draft:failed", () => {
      store.getState().handleEvent({
        stage: "draft", model: "openai", status: "failed", error: "API error",
      });

      const state = store.getState();
      expect(state.stages.draft.models.openai).toBe("failed");
    });

    it("should store error message on draft:failed", () => {
      store.getState().handleEvent({
        stage: "draft", model: "openai", status: "failed", error: "Rate limit exceeded",
      });

      expect(store.getState().errors).toContainEqual({
        stage: "draft",
        model: "openai",
        error: "Rate limit exceeded",
      });
    });
  });

  describe("handleEvent: review stage", () => {
    beforeEach(() => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "running", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });
    });

    it("should finalize draft stage on review:started", () => {
      store.getState().handleEvent({
        stage: "review", model: "anthropic", status: "started",
      });

      const state = store.getState();
      expect(state.stages.draft.status).toBe("complete");
      expect(state.stages.review.status).toBe("running");
      expect(state.stages.review.models.anthropic).toBe("running");
    });

    it("should set stage startedAt when transitioning to running", () => {
      const before = Date.now();
      store.getState().handleEvent({
        stage: "review", model: "anthropic", status: "started",
      });
      const after = Date.now();

      const state = store.getState();
      expect(state.stages.review.startedAt).toBeGreaterThanOrEqual(before);
      expect(state.stages.review.startedAt).toBeLessThanOrEqual(after);
    });

    it("should store error message on review:failed", () => {
      store.getState().handleEvent({
        stage: "review", model: "openai", status: "failed", error: "Structured output parse failed",
      });

      expect(store.getState().errors).toContainEqual({
        stage: "review",
        model: "openai",
        error: "Structured output parse failed",
      });
    });

    it("should store CrossReview on review:complete", () => {
      const review = makeCrossReview();
      store.getState().handleEvent({
        stage: "review", model: "anthropic", status: "complete", review,
      });

      const state = store.getState();
      expect(state.stages.review.models.anthropic).toBe("complete");
      expect(state.reviews.anthropic).toEqual(review);
    });
  });

  describe("handleEvent: synthesis stage", () => {
    beforeEach(() => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "complete", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          review: { status: "running", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });
    });

    it("should finalize review stage on synthesis:started", () => {
      store.getState().handleEvent({
        stage: "synthesis", model: "anthropic", status: "started",
      });

      const state = store.getState();
      expect(state.stages.review.status).toBe("complete");
      expect(state.stages.synthesis.status).toBe("running");
    });

    it("should store SynthesisResponse on synthesis:complete", () => {
      const result = makeSynthesisResponse();
      store.getState().handleEvent({
        stage: "synthesis", model: "anthropic", status: "complete", result,
      });

      const state = store.getState();
      expect(state.synthesis).toEqual(result);
      expect(state.stages.synthesis.status).toBe("complete");
    });

    it("should mark synthesis as failed on synthesis:failed", () => {
      store.getState().handleEvent({
        stage: "synthesis", model: "anthropic", status: "failed", error: "Synthesis error",
      });

      const state = store.getState();
      expect(state.stages.synthesis.models.anthropic).toBe("failed");
      expect(state.stages.synthesis.status).toBe("failed");
    });
  });

  describe("handleEvent: done", () => {
    beforeEach(() => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "complete", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          review: { status: "complete", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          synthesis: { status: "complete", models: { anthropic: "complete" }, durationMs: null, startedAt: null },
        },
      });
    });

    it("should set runStatus to complete and store result + mapping on done:complete", () => {
      const result = {
        status: "success",
        stages: {
          mapping: { "Response A": "anthropic", "Response B": "openai" },
        },
        telemetry: {
          stageDurationMs: { draft: 2100, review: 3400, synthesis: 1200 },
        },
      };

      store.getState().handleEvent({
        stage: "done", status: "complete", result,
      });

      const state = store.getState();
      expect(state.runStatus).toBe("complete");
      expect(state.result).toEqual(result);
      expect(state.mapping).toEqual({ "Response A": "anthropic", "Response B": "openai" });
    });

    it("should set runStatus to error on done:error", () => {
      store.getState().handleEvent({
        stage: "done", status: "error", error: "Pipeline failed",
      });

      const state = store.getState();
      expect(state.runStatus).toBe("error");
      expect(state.errorMessage).toBe("Pipeline failed");
    });
  });

  it("should ignore unknown event stages", () => {
    store.setState({ runStatus: "running", models: ["anthropic"] });
    const stateBefore = store.getState();

    store.getState().handleEvent({
      stage: "unknown", model: "anthropic", status: "started",
    });

    const stateAfter = store.getState();
    expect(stateAfter.runStatus).toBe(stateBefore.runStatus);
    expect(stateAfter.stages).toEqual(stateBefore.stages);
  });

  it("should return to initial state on reset after a run", () => {
    store.setState({
      runStatus: "complete",
      models: ["anthropic"],
      drafts: { anthropic: "text" },
      synthesis: makeSynthesisResponse(),
    });

    store.getState().reset();

    const state = store.getState();
    expect(state.runStatus).toBe("idle");
    expect(state.models).toEqual([]);
    expect(state.drafts).toEqual({});
    expect(state.synthesis).toBeNull();
  });

  describe("partial and total failure", () => {
    beforeEach(() => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai", "google"],
        stages: {
          draft: { status: "running", models: {}, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });
    });

    it("should set stage to partial when mix of success and failed", () => {
      // Complete two, fail one
      store.getState().handleEvent({ stage: "draft", model: "anthropic", status: "complete", response: "ok" });
      store.getState().handleEvent({ stage: "draft", model: "openai", status: "failed", error: "err" });
      store.getState().handleEvent({ stage: "draft", model: "google", status: "complete", response: "ok" });

      // Trigger finalization by starting review
      store.getState().handleEvent({ stage: "review", model: "anthropic", status: "started" });

      expect(store.getState().stages.draft.status).toBe("partial");
    });

    it("should set stage to failed when all models fail", () => {
      store.getState().handleEvent({ stage: "draft", model: "anthropic", status: "failed", error: "err" });
      store.getState().handleEvent({ stage: "draft", model: "openai", status: "failed", error: "err" });
      store.getState().handleEvent({ stage: "draft", model: "google", status: "failed", error: "err" });

      // Trigger finalization via done
      store.getState().handleEvent({
        stage: "done",
        status: "error",
        error: "All drafts failed",
      });

      expect(store.getState().stages.draft.status).toBe("failed");
    });
  });

  describe("done reconciliation", () => {
    it("should set stage durations from telemetry", () => {
      store.setState({
        runStatus: "running",
        models: ["anthropic"],
        stages: {
          draft: { status: "complete", models: { anthropic: "complete" }, durationMs: null, startedAt: null },
          review: { status: "complete", models: { anthropic: "complete" }, durationMs: null, startedAt: null },
          synthesis: { status: "complete", models: { anthropic: "complete" }, durationMs: null, startedAt: null },
        },
      });

      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "success",
          stages: { mapping: null },
          telemetry: {
            stageDurationMs: { draft: 1500, review: 2300, synthesis: 800 },
          },
        },
      });

      const state = store.getState();
      expect(state.stages.draft.durationMs).toBe(1500);
      expect(state.stages.review.durationMs).toBe(2300);
      expect(state.stages.synthesis.durationMs).toBe(800);
    });

    it("should mark stages that never ran as failed on early pipeline failure", () => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "running", models: { anthropic: "failed", openai: "failed" }, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });

      store.getState().handleEvent({
        stage: "done",
        status: "error",
        error: "All drafts failed",
      });

      const state = store.getState();
      expect(state.stages.draft.status).toBe("failed");
      expect(state.stages.review.status).toBe("failed");
      expect(state.stages.synthesis.status).toBe("failed");
    });

    it("should mark never-ran stages as failed on done:complete with result.status partial", () => {
      // Route sends done:"complete" even when result.status is "partial" or "failed"
      // All drafts failed but pipeline didn't throw → done:complete with result.status "failed"
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "running", models: { anthropic: "complete", openai: "failed" }, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });

      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "partial",
          stages: { mapping: null },
          telemetry: { stageDurationMs: { draft: 1000 } },
        },
      });

      const state = store.getState();
      expect(state.runStatus).toBe("complete");
      expect(state.stages.draft.status).toBe("partial");
      expect(state.stages.review.status).toBe("failed");
      expect(state.stages.synthesis.status).toBe("failed");
    });

    it("should mark never-ran stages as failed on done:complete with result.status failed", () => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "running", models: { anthropic: "failed", openai: "failed" }, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });

      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "failed",
          stages: { mapping: null },
          telemetry: { stageDurationMs: { draft: 500 } },
        },
      });

      const state = store.getState();
      expect(state.runStatus).toBe("complete");
      expect(state.stages.draft.status).toBe("failed");
      expect(state.stages.review.status).toBe("failed");
      expect(state.stages.synthesis.status).toBe("failed");
    });
  });

  describe("startRun", () => {
    it("should pre-populate draft models as pending at run start", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"stage":"done","status":"complete","result":{"status":"success","stages":{"mapping":null},"telemetry":{"stageDurationMs":{"draft":0,"review":0,"synthesis":0}}}}\n\n',
              ),
            );
            controller.close();
          },
        }),
      } as unknown as Response);

      const s = createConsortiumStore({
        fetcher: mockFetcher,
        getKeys: async () => ({ anthropic: "sk-ant", openai: "sk-oai" }),
      });

      // Start run but check state before stream events arrive
      const runPromise = s.getState().startRun("test", ["anthropic", "openai"], "anthropic", "general");

      // Before any events, all stages should show per-model pending indicators
      const state = s.getState();
      expect(state.stages.draft.models.anthropic).toBe("pending");
      expect(state.stages.draft.models.openai).toBe("pending");
      expect(state.stages.review.models.anthropic).toBe("pending");
      expect(state.stages.review.models.openai).toBe("pending");
      // Synthesis uses the synthesizer model only
      expect(state.stages.synthesis.models.anthropic).toBe("pending");
      expect(state.stages.synthesis.models.openai).toBeUndefined();

      await runPromise;
    });

    it("should call fetch with correct parameters", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"stage":"done","status":"complete","result":{"status":"success","stages":{"mapping":null},"telemetry":{"stageDurationMs":{"draft":0,"review":0,"synthesis":0}}}}\n\n',
              ),
            );
            controller.close();
          },
        }),
      } as unknown as Response);

      const s = createConsortiumStore({
        fetcher: mockFetcher,
        getKeys: async () => ({ anthropic: "sk-ant", openai: "sk-oai" }),
      });

      await s.getState().startRun("test prompt", ["anthropic", "openai"], "anthropic", "general");

      expect(mockFetcher).toHaveBeenCalledWith(
        "/api/consortium/run",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            prompt: "test prompt",
            models: ["anthropic", "openai"],
            synthesizer: "anthropic",
            workflow: "general",
            apiKeys: { anthropic: "sk-ant", openai: "sk-oai" },
          }),
        }),
      );
    });

    it("should set error when stream ends without done event", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"stage":"draft","model":"anthropic","status":"started"}\n\n'),
            );
            controller.close();
          },
        }),
      } as unknown as Response);

      const s = createConsortiumStore({
        fetcher: mockFetcher,
        getKeys: async () => ({ anthropic: "sk-ant" }),
      });

      await s.getState().startRun("test", ["anthropic"], "anthropic", "general");

      expect(s.getState().runStatus).toBe("error");
      expect(s.getState().errorMessage).toBe("Stream ended unexpectedly");
    });
  });

  describe("mergeErrors via done handler", () => {
    beforeEach(() => {
      store.setState({
        runStatus: "running",
        models: ["anthropic", "openai"],
        stages: {
          draft: { status: "complete", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          review: { status: "complete", models: { anthropic: "complete", openai: "complete" }, durationMs: null, startedAt: null },
          synthesis: { status: "complete", models: { anthropic: "complete" }, durationMs: null, startedAt: null },
        },
      });
    });

    it("should merge novel pipeline errors into state on done", () => {
      // Add an existing error from SSE events
      store.setState({
        errors: [{ stage: "draft", model: "google", error: "API error" }],
      });

      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "partial",
          stages: { mapping: null },
          telemetry: { stageDurationMs: { draft: 100, review: 200, synthesis: 50 } },
          errors: [
            { stage: "draft", model: "google", error: "API error" },  // duplicate
            { stage: "review", model: "openai", error: "Parse failed" },  // novel
          ],
        },
      });

      const errors = store.getState().errors;
      expect(errors).toHaveLength(2);
      expect(errors).toContainEqual({ stage: "draft", model: "google", error: "API error" });
      expect(errors).toContainEqual({ stage: "review", model: "openai", error: "Parse failed" });
    });

    it("should not duplicate errors when all are already present", () => {
      store.setState({
        errors: [
          { stage: "draft", model: "google", error: "API error" },
          { stage: "review", model: "openai", error: "Parse failed" },
        ],
      });

      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "partial",
          stages: { mapping: null },
          telemetry: { stageDurationMs: { draft: 100, review: 200, synthesis: 50 } },
          errors: [
            { stage: "draft", model: "google", error: "API error" },
            { stage: "review", model: "openai", error: "Parse failed" },
          ],
        },
      });

      expect(store.getState().errors).toHaveLength(2);
    });

    it("should deduplicate errors within the incoming batch", () => {
      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "partial",
          stages: { mapping: null },
          telemetry: { stageDurationMs: { draft: 100, review: 200, synthesis: 50 } },
          errors: [
            { stage: "draft", model: "google", error: "API error" },
            { stage: "draft", model: "google", error: "API error" },  // duplicate within batch
          ],
        },
      });

      const errors = store.getState().errors;
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({ stage: "draft", model: "google", error: "API error" });
    });

    it("should preserve existing errors when result has no errors", () => {
      store.setState({
        errors: [{ stage: "draft", model: "google", error: "API error" }],
      });

      store.getState().handleEvent({
        stage: "done",
        status: "complete",
        result: {
          status: "success",
          stages: { mapping: null },
          telemetry: { stageDurationMs: { draft: 100, review: 200, synthesis: 50 } },
        },
      });

      expect(store.getState().errors).toHaveLength(1);
    });
  });

  describe("stale-run protection", () => {
    it("should ignore events from a stale run after a new run starts", async () => {
      // We'll test this by manipulating runId directly
      const s = createConsortiumStore();

      // Simulate run A initialization
      s.setState({
        runStatus: "running",
        runId: 1,
        models: ["anthropic"],
        stages: {
          draft: { status: "running", models: {}, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });

      // Process an event from run A — should work
      s.getState().handleEvent({ stage: "draft", model: "anthropic", status: "complete", response: "Run A draft" });
      expect(s.getState().drafts.anthropic).toBe("Run A draft");

      // Simulate run B starting (increments runId)
      s.setState({
        runStatus: "running",
        runId: 2,
        models: ["anthropic"],
        drafts: {},
        stages: {
          draft: { status: "running", models: {}, durationMs: null, startedAt: null },
          review: { status: "pending", models: {}, durationMs: null, startedAt: null },
          synthesis: { status: "pending", models: {}, durationMs: null, startedAt: null },
        },
      });

      // Now handleEvent doesn't carry runId — it always applies to current state.
      // The stale-run guard lives in startRun's for-await loop, not in handleEvent.
      // So for this test, we verify the startRun level guard via the mock approach:

      let resolveStreamA: (() => void) | undefined;
      const streamA = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"stage":"draft","model":"anthropic","status":"complete","response":"Stale A"}\n\n'),
          );
          // Wait before closing so run B can start
          await new Promise<void>((r) => { resolveStreamA = r; });
          controller.close();
        },
      });

      let callCount = 0;
      const mockFetcher = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: true, status: 200, body: streamA } as unknown as Response);
        }
        // Run B returns immediately with a done event
        return Promise.resolve({
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"stage":"draft","model":"anthropic","status":"complete","response":"Fresh B"}\n\n' +
                  'data: {"stage":"done","status":"complete","result":{"status":"success","stages":{"mapping":null},"telemetry":{"stageDurationMs":{"draft":0,"review":0,"synthesis":0}}}}\n\n',
                ),
              );
              controller.close();
            },
          }),
        } as unknown as Response);
      });

      const store2 = createConsortiumStore({
        fetcher: mockFetcher,
        getKeys: async () => ({ anthropic: "sk-ant" }),
      });

      // Start run A
      const runAPromise = store2.getState().startRun("prompt A", ["anthropic"], "anthropic", "general");

      // Give run A a tick to start
      await new Promise((r) => setTimeout(r, 10));

      // Start run B (should abort run A)
      await store2.getState().startRun("prompt B", ["anthropic"], "anthropic", "general");

      // Let stream A close
      resolveStreamA?.();
      await runAPromise.catch(() => {});

      // Final state should reflect run B, not stale run A
      const finalState = store2.getState();
      expect(finalState.drafts.anthropic).toBe("Fresh B");
      expect(finalState.runStatus).toBe("complete");
    });
  });
});
