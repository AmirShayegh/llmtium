import type {
  Provider,
  ProviderConfig,
  DraftResponse,
  JsonSchema,
} from "../providers/types.js";
import type { AnonymizedResponse } from "./anonymizer.js";
import type { CrossReview } from "./cross-review.js";
import type { SynthesisResponse } from "./synthesis-response.js";
import type { PipelineEvent } from "./pipeline-event.js";

export interface ProviderWithConfig {
  provider: Provider;
  config: ProviderConfig;
}

export interface ReviewPromptParams {
  userPrompt: string;
  responses: AnonymizedResponse[];
}

export interface SynthesisPromptParams {
  userPrompt: string;
  drafts: AnonymizedResponse[];
  reviews: Array<{ reviewerId: string; review: CrossReview }>;
}

export interface StagePromptConfig<P> {
  buildPrompt: (params: P) => { systemPrompt: string; userPrompt: string };
  schema: JsonSchema;
  toolName: string;
  toolDescription: string;
}

export interface PipelineConfig {
  prompt: string;
  systemPrompt?: string;
  providers: ProviderWithConfig[];
  synthesizer: ProviderWithConfig;
  review: StagePromptConfig<ReviewPromptParams>;
  synthesis: StagePromptConfig<SynthesisPromptParams>;
  onProgress?: (event: PipelineEvent) => void;
}

export type DraftResult =
  | { status: "success"; response: DraftResponse }
  | { status: "failed"; error: string };

export type ReviewResult =
  | { status: "success"; review: CrossReview }
  | { status: "failed"; error: string };

export interface PipelineError {
  stage: "draft" | "review" | "synthesis";
  model: string;
  error: string;
}

export interface PipelineTelemetry {
  totalDurationMs: number;
  stageDurationMs: { draft: number; review: number; synthesis: number };
  draftTokens: Record<string, { tokensIn: number; tokensOut: number }>;
  // Review and synthesis token counts not available — ProviderResult<T> doesn't include usage metadata
}

export interface PipelineResult {
  status: "success" | "partial" | "failed";
  drafts: Map<string, DraftResult>;
  reviews: Map<string, ReviewResult>;
  synthesis: SynthesisResponse | null;
  mapping: Map<string, string> | null;
  errors: PipelineError[];
  telemetry: PipelineTelemetry;
}
