import type {
  PipelineConfig,
  PipelineResult,
  ProviderWithConfig,
  ReviewPromptParams,
  SynthesisPromptParams,
} from "../types/pipeline.js";
import type { WorkflowResult, WorkflowInput } from "../types/workflow.js";
import { CROSS_REVIEW_SCHEMA } from "../schemas/cross-review.schema.js";
import { SYNTHESIS_RESPONSE_SCHEMA } from "../schemas/synthesis-response.schema.js";
import { runPipeline } from "../engine/orchestrator.js";

export interface ReviewPlanInput {
  plan: string;
  context?: string;
  providers: ProviderWithConfig[];
  synthesizer: ProviderWithConfig;
}

export async function reviewPlan(input: ReviewPlanInput): Promise<WorkflowResult> {
  const config: PipelineConfig = {
    prompt: buildDraftUserPrompt(input.plan, input.context),
    systemPrompt: REVIEW_PLAN_SYSTEM_PROMPT,
    providers: input.providers,
    synthesizer: input.synthesizer,
    review: {
      buildPrompt: buildReviewPrompt,
      schema: CROSS_REVIEW_SCHEMA,
      toolName: "submit_review",
      toolDescription: "Submit your structured review of the responses",
    },
    synthesis: {
      buildPrompt: buildSynthesisPrompt,
      schema: SYNTHESIS_RESPONSE_SCHEMA,
      toolName: "submit_synthesis",
      toolDescription: "Submit your structured synthesis of the deliberation",
    },
  };

  const result = await runPipeline(config);
  return toWorkflowResult(input, result);
}

// --- Prompt Constants ---

const REVIEW_PLAN_SYSTEM_PROMPT = `You are an expert technical reviewer. A user has submitted a plan for review. Analyze this plan thoroughly and provide your independent assessment.

Focus on:
- Feasibility: Can this actually be built as described?
- Completeness: What's missing or underspecified?
- Risks: What could go wrong? What are the biggest unknowns?
- Sequencing: Is the order of operations correct? Are there dependencies?
- Alternatives: Are there better approaches the plan doesn't consider?

Be specific and concrete. Reference specific parts of the plan. Do not just say "looks good" — find the problems.`;

const CROSS_REVIEW_SYSTEM_PROMPT = `You are a critical reviewer in a multi-expert deliberation process. You have been given a user's original prompt and multiple independent responses from other experts. Your identities are hidden from each other to ensure unbiased evaluation.

Your job is to carefully evaluate each response, surface disagreements between them, and identify what's missing. Be rigorous. Do not be generous — your critique directly improves the final output.

You MUST respond with valid JSON matching the schema below. No markdown, no preamble, no explanation outside the JSON.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are the lead synthesizer in a multi-expert deliberation process. Multiple experts have independently responded to a user's prompt, and then critically reviewed each other's work. You now have all responses and all structured reviews.

Your job is to produce the best possible final response by:
1. Merging the strongest elements from each expert's response
2. Resolving disagreements identified in the reviews (state what you chose and why)
3. Addressing issues and gaps the reviewers surfaced
4. Filling in missing information the reviewers identified
5. Being direct about what remains uncertain or unresolved

Do not be a diplomat. Do not average opinions. Take positions where the evidence supports it. Flag uncertainty where it doesn't.

You MUST respond with valid JSON matching the schema below. No markdown, no preamble, no explanation outside the JSON.`;

// --- Prompt Builders ---

function buildDraftUserPrompt(plan: string, context?: string): string {
  let prompt = `## Plan to Review\n\n${plan}`;
  if (context) {
    prompt += `\n\n## Additional Context\n\n${context}`;
  }
  return prompt;
}

function buildReviewPrompt(params: ReviewPromptParams): { systemPrompt: string; userPrompt: string } {
  const responseSections = params.responses
    .map((r) => `### ${r.label}\n\n${r.content}`)
    .join("\n\n---\n\n");

  const userPrompt = `## Original Prompt\n\n${params.userPrompt}\n\n## Responses to Review\n\n${responseSections}\n\n## Your Task\n\nEvaluate these responses against the original prompt. Produce a JSON review with:\n- Scores (1-5) for each response on correctness, completeness, actionability, and clarity\n- The most important issues you found across all responses\n- Explicit disagreements between responses, with direct quotes\n- Information that is missing from ALL responses\n- Your confidence level (0-1) in your own assessment`;

  return { systemPrompt: CROSS_REVIEW_SYSTEM_PROMPT, userPrompt };
}

function buildSynthesisPrompt(params: SynthesisPromptParams): { systemPrompt: string; userPrompt: string } {
  const draftSections = params.drafts
    .map((d) => `### ${d.label}\n\n${d.content}`)
    .join("\n\n---\n\n");

  const reviewSections = params.reviews
    .map(({ reviewerId, review }) => {
      const scoreLines = Object.entries(review.scores)
        .map(([label, s]) => `- ${label}: correctness=${s.correctness}, completeness=${s.completeness}, actionability=${s.actionability}, clarity=${s.clarity}`)
        .join("\n");

      const issues = review.issues.join("; ");

      const disagreementLines = review.disagreements
        .map((d) => `- ${d.topic}: ${d.a.response_id} says "${d.a.quote}" vs ${d.b.response_id} says "${d.b.quote}" — Reviewer says: ${d.assessment}`)
        .join("\n");

      const missingInfo = review.missing_info.join("; ");

      return `### Review by ${reviewerId}\n\n**Scores:**\n${scoreLines}\n\n**Issues:** ${issues}\n\n**Disagreements:**\n${disagreementLines}\n\n**Missing info:** ${missingInfo}\n\n**Reviewer confidence:** ${review.confidence} — ${review.confidence_reason}`;
    })
    .join("\n\n---\n\n");

  const userPrompt = `## Original Prompt\n\n${params.userPrompt}\n\n## Expert Responses\n\n${draftSections}\n\n## Structured Reviews\n\n${reviewSections}\n\n## Your Task\n\nSynthesize the best possible response to the original prompt. Use the reviews to guide which elements to keep, which disagreements to resolve, and what gaps to fill.`;

  return { systemPrompt: SYNTHESIS_SYSTEM_PROMPT, userPrompt };
}

// --- Result Mapping ---

function compositeId(pwc: ProviderWithConfig): string {
  return `${pwc.provider.meta.id}/${pwc.config.model ?? pwc.provider.meta.defaultModel}`;
}

function toWorkflowResult(input: ReviewPlanInput, pipelineResult: PipelineResult): WorkflowResult {
  const workflowInput: WorkflowInput = {
    prompt: input.plan,
    context: input.context,
    workflow: "review_plan",
    models: input.providers.map((p) => compositeId(p)),
    synthesizer: compositeId(input.synthesizer),
  };

  return {
    status: pipelineResult.status,
    input: workflowInput,
    stages: {
      drafts: pipelineResult.drafts,
      reviews: pipelineResult.reviews,
      synthesis: pipelineResult.synthesis,
      mapping: pipelineResult.mapping,
    },
    errors: pipelineResult.errors,
    telemetry: pipelineResult.telemetry,
    pipeline: pipelineResult,
  };
}
