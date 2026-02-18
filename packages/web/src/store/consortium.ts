import { createStore } from "zustand/vanilla";
import type { CrossReview, SynthesisResponse, PipelineError } from "@llmtium/core";
import type { SerializedWorkflowResult } from "@/lib/serialize";
import { parseSSE } from "@/lib/sse";

export type RunStatus = "idle" | "running" | "complete" | "error";
export type StageStatus = "pending" | "running" | "complete" | "partial" | "failed";
export type ModelStatus = "pending" | "running" | "complete" | "failed";

export interface StageState {
  status: StageStatus;
  models: Record<string, ModelStatus>;
  durationMs: number | null;
  startedAt: number | null;
}

export interface ConsortiumState {
  runStatus: RunStatus;
  runId: number;
  prompt: string;
  models: string[];
  synthesizer: string;

  stages: {
    draft: StageState;
    review: StageState;
    synthesis: StageState;
  };

  drafts: Record<string, string>;
  reviews: Record<string, CrossReview>;
  synthesis: SynthesisResponse | null;

  mapping: Record<string, string> | null;

  result: SerializedWorkflowResult | null;
  errors: PipelineError[];
  errorMessage: string | null;

  startedAt: number | null;

  handleEvent: (event: Record<string, unknown>) => void;
  startRun: (prompt: string, models: string[], synthesizer: string) => Promise<void>;
  reset: () => void;
}

function makeStage(): StageState {
  return { status: "pending", models: {}, durationMs: null, startedAt: null };
}

function makeInitialState() {
  return {
    runStatus: "idle" as RunStatus,
    runId: 0,
    prompt: "",
    models: [] as string[],
    synthesizer: "",
    stages: { draft: makeStage(), review: makeStage(), synthesis: makeStage() },
    drafts: {} as Record<string, string>,
    reviews: {} as Record<string, CrossReview>,
    synthesis: null as SynthesisResponse | null,
    mapping: null as Record<string, string> | null,
    result: null as SerializedWorkflowResult | null,
    errors: [] as PipelineError[],
    errorMessage: null as string | null,
    startedAt: null as number | null,
  };
}

function finalizeStage(stage: StageState): StageStatus {
  const statuses = Object.values(stage.models);
  if (statuses.length === 0) return stage.status;
  const allComplete = statuses.every((s) => s === "complete");
  const allFailed = statuses.every((s) => s === "failed");
  if (allComplete) return "complete";
  if (allFailed) return "failed";
  return "partial";
}

export interface ConsortiumStoreOptions {
  fetcher?: typeof globalThis.fetch;
  getKeys?: () => Promise<Record<string, string>>;
}

let _abortController: AbortController | null = null;

export function createConsortiumStore(options?: ConsortiumStoreOptions) {
  const fetcher = options?.fetcher;
  const getKeys = options?.getKeys;

  return createStore<ConsortiumState>()((set, get) => ({
    ...makeInitialState(),

    handleEvent: (event: Record<string, unknown>) => {
      const stage = event.stage as string;
      const status = event.status as string;
      const model = event.model as string | undefined;

      if (stage === "draft") {
        set((state) => {
          const draft = { ...state.stages.draft };
          if (status === "started") {
            draft.status = "running";
            if (draft.startedAt === null) draft.startedAt = Date.now();
            draft.models = { ...draft.models, [model!]: "running" as ModelStatus };
          } else if (status === "complete") {
            draft.models = { ...draft.models, [model!]: "complete" as ModelStatus };
            return {
              stages: { ...state.stages, draft },
              drafts: { ...state.drafts, [model!]: event.response as string },
            };
          } else if (status === "failed") {
            draft.models = { ...draft.models, [model!]: "failed" as ModelStatus };
            return {
              stages: { ...state.stages, draft },
              errors: [...state.errors, { stage: "draft", model: model!, error: (event.error as string) ?? "Unknown error" }],
            };
          }
          return { stages: { ...state.stages, draft } };
        });
      } else if (stage === "review") {
        set((state) => {
          const draft = { ...state.stages.draft, status: finalizeStage(state.stages.draft) };
          const review = { ...state.stages.review };
          if (status === "started") {
            review.status = "running";
            if (review.startedAt === null) review.startedAt = Date.now();
            review.models = { ...review.models, [model!]: "running" as ModelStatus };
          } else if (status === "complete") {
            review.models = { ...review.models, [model!]: "complete" as ModelStatus };
            return {
              stages: { ...state.stages, draft, review },
              reviews: { ...state.reviews, [model!]: event.review as CrossReview },
            };
          } else if (status === "failed") {
            review.models = { ...review.models, [model!]: "failed" as ModelStatus };
            return {
              stages: { ...state.stages, draft, review },
              errors: [...state.errors, { stage: "review", model: model!, error: (event.error as string) ?? "Unknown error" }],
            };
          }
          return { stages: { ...state.stages, draft, review } };
        });
      } else if (stage === "synthesis") {
        set((state) => {
          const review = { ...state.stages.review, status: finalizeStage(state.stages.review) };
          const synthesis = { ...state.stages.synthesis };
          if (status === "started") {
            synthesis.status = "running";
            if (synthesis.startedAt === null) synthesis.startedAt = Date.now();
            if (model) {
              synthesis.models = { ...synthesis.models, [model]: "running" as ModelStatus };
            }
          } else if (status === "complete") {
            synthesis.status = "complete";
            if (model) {
              synthesis.models = { ...synthesis.models, [model]: "complete" as ModelStatus };
            }
            return {
              stages: { ...state.stages, review, synthesis },
              synthesis: event.result as SynthesisResponse,
            };
          } else if (status === "failed") {
            synthesis.status = "failed";
            if (model) {
              synthesis.models = { ...synthesis.models, [model]: "failed" as ModelStatus };
            }
            return {
              stages: { ...state.stages, review, synthesis },
              errors: [...state.errors, { stage: "synthesis", model: model ?? "unknown", error: (event.error as string) ?? "Unknown error" }],
            };
          }
          return { stages: { ...state.stages, review, synthesis } };
        });
      } else if (stage === "done") {
        set((state) => {
          const result = event.result as SerializedWorkflowResult | undefined;
          const telemetry = result?.telemetry as { stageDurationMs?: Record<string, number> } | undefined;
          const durations = telemetry?.stageDurationMs;

          // Reconcile stage statuses
          const draft = { ...state.stages.draft };
          const review = { ...state.stages.review };
          const synthesis = { ...state.stages.synthesis };

          // Set durations from telemetry
          if (durations) {
            draft.durationMs = durations.draft ?? null;
            review.durationMs = durations.review ?? null;
            synthesis.durationMs = durations.synthesis ?? null;
          }

          // Finalize stages that have models
          if (Object.keys(draft.models).length > 0) {
            draft.status = finalizeStage(draft);
          }
          if (Object.keys(review.models).length > 0) {
            review.status = finalizeStage(review);
          }
          if (Object.keys(synthesis.models).length > 0 && synthesis.status !== "complete") {
            synthesis.status = finalizeStage(synthesis);
          }

          // Stages that never ran (still pending) → failed
          // Check both event status AND result.status — route sends done:"complete"
          // even when result.status is "partial" or "failed"
          const resultStatus = result?.status as string | undefined;
          const hasFailure = status === "error" || resultStatus === "partial" || resultStatus === "failed";

          if (hasFailure) {
            if (draft.status === "pending" || draft.status === "running") {
              draft.status = Object.keys(draft.models).length > 0 ? finalizeStage(draft) : "failed";
            }
            if (review.status === "pending") review.status = "failed";
            if (synthesis.status === "pending") synthesis.status = "failed";
          }

          const mapping = result?.stages?.mapping as Record<string, string> | null ?? null;

          if (status === "complete") {
            return {
              runStatus: "complete" as RunStatus,
              result: result ?? null,
              mapping,
              stages: { draft, review, synthesis },
            };
          } else {
            return {
              runStatus: "error" as RunStatus,
              errorMessage: (event.error as string) ?? "Unknown error",
              stages: { draft, review, synthesis },
            };
          }
        });
      }
      // Unknown stages are silently ignored
    },

    startRun: async (prompt: string, models: string[], synthesizer: string) => {
      // Abort prior run
      if (_abortController) {
        _abortController.abort();
      }

      const runId = get().runId + 1;
      _abortController = new AbortController();
      const currentRunId = runId;

      const pendingModels: Record<string, ModelStatus> = {};
      for (const m of models) {
        pendingModels[m] = "pending";
      }

      const initial = makeInitialState();
      set({
        ...initial,
        runStatus: "running",
        runId,
        prompt,
        models,
        synthesizer,
        startedAt: Date.now(),
        stages: {
          draft: { ...initial.stages.draft, models: { ...pendingModels } },
          review: { ...initial.stages.review, models: { ...pendingModels } },
          synthesis: { ...initial.stages.synthesis, models: { [synthesizer]: "pending" as ModelStatus } },
        },
      });

      let receivedDone = false;

      try {
        const apiKeys = getKeys ? await getKeys() : {};

        const stream = parseSSE({
          url: "/api/consortium/run",
          body: { prompt, models, synthesizer, apiKeys },
          signal: _abortController.signal,
          fetcher,
        });

        for await (const event of stream) {
          // Stale-run guard
          if (get().runId !== currentRunId) break;

          const evt = event as Record<string, unknown>;
          if (evt.stage === "done") receivedDone = true;
          get().handleEvent(evt);
        }

        // Stream ended — check if we got a "done" event
        if (get().runId === currentRunId && !receivedDone) {
          set({ runStatus: "error", errorMessage: "Stream ended unexpectedly" });
        }
      } catch (error) {
        // Ignore abort errors from cancelled runs
        if (get().runId !== currentRunId) return;
        if (error instanceof DOMException && error.name === "AbortError") return;

        const msg = error instanceof Error ? error.message : String(error);
        set({ runStatus: "error", errorMessage: msg });
      }
    },

    reset: () => {
      if (_abortController) {
        _abortController.abort();
        _abortController = null;
      }
      set(makeInitialState());
    },
  }));
}
