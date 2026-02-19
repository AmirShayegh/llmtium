import type { CrossReview } from "./cross-review.js";
import type { SynthesisResponse } from "./synthesis-response.js";

export type PipelineEvent =
  | { stage: "draft"; model: string; status: "started" }
  | { stage: "draft"; model: string; status: "complete"; response: string }
  | { stage: "draft"; model: string; status: "failed"; error: string }
  | { stage: "review"; model: string; status: "started" }
  | { stage: "review"; model: string; status: "complete"; review: CrossReview }
  | { stage: "review"; model: string; status: "failed"; error: string }
  | { stage: "synthesis"; model: string; status: "started" }
  | { stage: "synthesis"; model: string; status: "complete"; result: SynthesisResponse }
  | { stage: "synthesis"; model: string; status: "failed"; error: string };
