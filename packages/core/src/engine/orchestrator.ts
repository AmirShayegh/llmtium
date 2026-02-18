import type { DraftResponse, ProviderResult } from "../providers/types.js";
import type { CrossReview } from "../types/cross-review.js";
import type { SynthesisResponse } from "../types/synthesis-response.js";
import type { PipelineEvent } from "../types/pipeline-event.js";
import type {
  PipelineConfig,
  PipelineResult,
  PipelineError,
  DraftResult,
  ReviewResult,
  PipelineTelemetry,
  ProviderWithConfig,
} from "../types/pipeline.js";
import { anonymize, shuffleForReviewer } from "./anonymizer.js";
import type { AnonymizedResponse } from "../types/anonymizer.js";

const MIN_DRAFTS = 2;
const MIN_REVIEWS = 1;

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const validationError = validateConfig(config);
  if (validationError) {
    return makeFailedResult([{ stage: "draft", model: "pipeline", error: validationError }]);
  }

  // Failure-isolated emit — callback errors never affect pipeline behavior
  const safeEmit = (event: PipelineEvent): void => {
    try { config.onProgress?.(event); } catch { /* callback errors are swallowed */ }
  };

  const totalStart = Date.now();
  const errors: PipelineError[] = [];
  const telemetry: PipelineTelemetry = {
    totalDurationMs: 0,
    stageDurationMs: { draft: 0, review: 0, synthesis: 0 },
    draftTokens: {},
  };

  // Stage 1: Parallel Draft
  const draftStart = Date.now();
  const drafts = await runDraftStage(config, errors, telemetry, safeEmit);
  telemetry.stageDurationMs.draft = Date.now() - draftStart;

  const successfulDrafts = getSuccessfulDrafts(drafts);
  if (successfulDrafts.size < MIN_DRAFTS) {
    telemetry.totalDurationMs = Date.now() - totalStart;
    return { status: "failed", drafts, reviews: new Map(), synthesis: null, mapping: null, errors, telemetry };
  }

  // Anonymize
  let anonymized: AnonymizedResponse[];
  let mapping: Map<string, string>;
  try {
    const draftContentMap = new Map<string, string>();
    for (const [modelId, response] of successfulDrafts) {
      draftContentMap.set(modelId, response.content);
    }
    const result = anonymize(draftContentMap);
    anonymized = result.anonymized;
    mapping = result.mapping;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ stage: "review", model: "pipeline", error: msg });
    telemetry.totalDurationMs = Date.now() - totalStart;
    return { status: "failed", drafts, reviews: new Map(), synthesis: null, mapping: null, errors, telemetry };
  }

  // Stage 2: Cross-Review
  const reviewStart = Date.now();
  const reviews = await runReviewStage(config, successfulDrafts, anonymized, mapping, errors, safeEmit);
  telemetry.stageDurationMs.review = Date.now() - reviewStart;

  const successfulReviews = getSuccessfulReviews(reviews);
  if (successfulReviews.size < MIN_REVIEWS) {
    telemetry.totalDurationMs = Date.now() - totalStart;
    return { status: "partial", drafts, reviews, synthesis: null, mapping, errors, telemetry };
  }

  // Stage 3: Synthesis
  const synthStart = Date.now();
  const synthesis = await runSynthesisStage(config, anonymized, successfulReviews, errors, safeEmit);
  telemetry.stageDurationMs.synthesis = Date.now() - synthStart;

  telemetry.totalDurationMs = Date.now() - totalStart;
  const status = errors.length === 0 ? "success" : "partial";
  return { status, drafts, reviews, synthesis, mapping, errors, telemetry };
}

// --- Config Validation ---

function validateConfig(config: PipelineConfig): string | null {
  if (config.providers.length < MIN_DRAFTS) {
    return "At least 2 providers required";
  }
  const ids = config.providers.map((p) => p.provider.meta.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return `Duplicate provider ID: ${id}`;
    }
    seen.add(id);
  }
  return null;
}

// --- Stage 1: Parallel Draft ---

async function runDraftStage(
  config: PipelineConfig,
  errors: PipelineError[],
  telemetry: PipelineTelemetry,
  emit: (event: PipelineEvent) => void,
): Promise<Map<string, DraftResult>> {
  const drafts = new Map<string, DraftResult>();

  const settled = await Promise.allSettled(
    config.providers.map(async (pwc) => {
      emit({ stage: "draft", model: pwc.provider.meta.id, status: "started" });
      return pwc.provider.draft(pwc.config, { userPrompt: config.prompt, systemPrompt: config.systemPrompt });
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const modelId = config.providers[i]!.provider.meta.id;
    const outcome = settled[i]!;

    if (outcome.status === "rejected") {
      const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      drafts.set(modelId, { status: "failed", error: msg });
      errors.push({ stage: "draft", model: modelId, error: msg });
      emit({ stage: "draft", model: modelId, status: "failed", error: msg });
    } else if (!outcome.value.success) {
      drafts.set(modelId, { status: "failed", error: outcome.value.error });
      errors.push({ stage: "draft", model: modelId, error: outcome.value.error });
      emit({ stage: "draft", model: modelId, status: "failed", error: outcome.value.error });
    } else {
      drafts.set(modelId, { status: "success", response: outcome.value.data });
      telemetry.draftTokens[modelId] = {
        tokensIn: outcome.value.data.tokensIn,
        tokensOut: outcome.value.data.tokensOut,
      };
      emit({ stage: "draft", model: modelId, status: "complete", response: outcome.value.data.content });
    }
  }

  return drafts;
}

// --- Stage 2: Cross-Review ---

async function runReviewStage(
  config: PipelineConfig,
  successfulDrafts: Map<string, DraftResponse>,
  anonymized: AnonymizedResponse[],
  mapping: Map<string, string>,
  errors: PipelineError[],
  emit: (event: PipelineEvent) => void,
): Promise<Map<string, ReviewResult>> {
  const reviews = new Map<string, ReviewResult>();

  // Build reverse map: modelId → label
  const modelToLabel = new Map<string, string>();
  for (const [label, modelId] of mapping) {
    modelToLabel.set(modelId, label);
  }

  // Find the ProviderWithConfig for each successful drafter
  const reviewerPwcs: Array<{ modelId: string; pwc: ProviderWithConfig }> = [];
  for (const modelId of successfulDrafts.keys()) {
    const pwc = config.providers.find((p) => p.provider.meta.id === modelId);
    if (pwc) reviewerPwcs.push({ modelId, pwc });
  }

  const settled = await Promise.allSettled(
    reviewerPwcs.map(async ({ modelId, pwc }) => {
      emit({ stage: "review", model: modelId, status: "started" });

      const ownLabel = modelToLabel.get(modelId);
      const othersResponses = anonymized.filter((r) => r.label !== ownLabel);
      const shuffled = shuffleForReviewer(othersResponses, modelId);

      const { systemPrompt, userPrompt } = config.review.buildPrompt({
        userPrompt: config.prompt,
        responses: shuffled,
      });

      return pwc.provider.structuredOutput<CrossReview>(pwc.config, {
        userPrompt,
        systemPrompt,
        schema: config.review.schema,
        toolName: config.review.toolName,
        toolDescription: config.review.toolDescription,
      });
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const modelId = reviewerPwcs[i]!.modelId;
    const outcome = settled[i]!;

    if (outcome.status === "rejected") {
      const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      reviews.set(modelId, { status: "failed", error: msg });
      errors.push({ stage: "review", model: modelId, error: msg });
      emit({ stage: "review", model: modelId, status: "failed", error: msg });
    } else if (!outcome.value.success) {
      reviews.set(modelId, { status: "failed", error: outcome.value.error });
      errors.push({ stage: "review", model: modelId, error: outcome.value.error });
      emit({ stage: "review", model: modelId, status: "failed", error: outcome.value.error });
    } else {
      reviews.set(modelId, { status: "success", review: outcome.value.data });
      emit({ stage: "review", model: modelId, status: "complete", review: outcome.value.data });
    }
  }

  return reviews;
}

// --- Stage 3: Synthesis ---

async function runSynthesisStage(
  config: PipelineConfig,
  anonymized: AnonymizedResponse[],
  successfulReviews: Map<string, CrossReview>,
  errors: PipelineError[],
  emit: (event: PipelineEvent) => void,
): Promise<SynthesisResponse | null> {
  const synthModelId = config.synthesizer.provider.meta.id;
  emit({ stage: "synthesis", model: synthModelId, status: "started" });

  const reviewEntries = [...successfulReviews.entries()].map(([reviewerId, review]) => ({
    reviewerId,
    review,
  }));

  let result: ProviderResult<SynthesisResponse>;
  try {
    const { systemPrompt, userPrompt } = config.synthesis.buildPrompt({
      userPrompt: config.prompt,
      drafts: anonymized,
      reviews: reviewEntries,
    });

    result = await config.synthesizer.provider.structuredOutput<SynthesisResponse>(
      config.synthesizer.config,
      {
        userPrompt,
        systemPrompt,
        schema: config.synthesis.schema,
        toolName: config.synthesis.toolName,
        toolDescription: config.synthesis.toolDescription,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ stage: "synthesis", model: synthModelId, error: msg });
    emit({ stage: "synthesis", model: synthModelId, status: "failed", error: msg });
    return null;
  }

  if (!result.success) {
    errors.push({ stage: "synthesis", model: synthModelId, error: result.error });
    emit({ stage: "synthesis", model: synthModelId, status: "failed", error: result.error });
    return null;
  }

  emit({ stage: "synthesis", status: "complete", result: result.data });
  return result.data;
}

// --- Helpers ---

function getSuccessfulDrafts(drafts: Map<string, DraftResult>): Map<string, DraftResponse> {
  const result = new Map<string, DraftResponse>();
  for (const [modelId, draft] of drafts) {
    if (draft.status === "success") {
      result.set(modelId, draft.response);
    }
  }
  return result;
}

function getSuccessfulReviews(reviews: Map<string, ReviewResult>): Map<string, CrossReview> {
  const result = new Map<string, CrossReview>();
  for (const [modelId, review] of reviews) {
    if (review.status === "success") {
      result.set(modelId, review.review);
    }
  }
  return result;
}

function makeFailedResult(errors: PipelineError[]): PipelineResult {
  return {
    status: "failed",
    drafts: new Map(),
    reviews: new Map(),
    synthesis: null,
    mapping: null,
    errors,
    telemetry: {
      totalDurationMs: 0,
      stageDurationMs: { draft: 0, review: 0, synthesis: 0 },
      draftTokens: {},
    },
  };
}
