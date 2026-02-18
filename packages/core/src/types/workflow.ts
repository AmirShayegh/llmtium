import type {
  PipelineResult,
  PipelineError,
  PipelineTelemetry,
  DraftResult,
  ReviewResult,
} from "./pipeline.js";
import type { SynthesisResponse } from "./synthesis-response.js";

export type WorkflowType = "review_plan";

export interface WorkflowInput {
  prompt: string;
  context?: string;
  workflow: WorkflowType;
  models: string[];
  synthesizer: string;
}

export interface WorkflowResult {
  status: "success" | "partial" | "failed";
  input: WorkflowInput;
  stages: {
    drafts: Map<string, DraftResult>;
    reviews: Map<string, ReviewResult>;
    synthesis: SynthesisResponse | null;
    mapping: Map<string, string> | null;
  };
  errors: PipelineError[];
  telemetry: PipelineTelemetry;
  pipeline: PipelineResult;
}
