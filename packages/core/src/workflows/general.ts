import type {
  PipelineConfig,
  ProviderWithConfig,
} from "../types/pipeline.js";
import type { PipelineEvent } from "../types/pipeline-event.js";
import type { WorkflowResult } from "../types/workflow.js";
import { CROSS_REVIEW_SCHEMA } from "../schemas/cross-review.schema.js";
import { SYNTHESIS_RESPONSE_SCHEMA } from "../schemas/synthesis-response.schema.js";
import { runPipeline } from "../engine/orchestrator.js";
import { buildReviewPrompt, buildSynthesisPrompt } from "./shared-prompts.js";
import { toWorkflowResult } from "./workflow-result.js";

export interface GeneralInput {
  prompt: string;
  context?: string;
  providers: ProviderWithConfig[];
  synthesizer: ProviderWithConfig;
  onProgress?: (event: PipelineEvent) => void;
}

export async function general(input: GeneralInput): Promise<WorkflowResult> {
  const config: PipelineConfig = {
    prompt: buildDraftUserPrompt(input.prompt, input.context),
    systemPrompt: GENERAL_SYSTEM_PROMPT,
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
    onProgress: input.onProgress,
  };

  const result = await runPipeline(config);
  return toWorkflowResult(
    { prompt: input.prompt, context: input.context, workflow: "general", providers: input.providers, synthesizer: input.synthesizer },
    result,
  );
}

// --- Prompt Constants ---

const GENERAL_SYSTEM_PROMPT = `You are an expert analyst participating in a multi-perspective deliberation. A user has submitted a prompt for analysis by multiple independent experts. Provide your thorough, independent response.

Focus on:
- Correctness: Are your claims accurate and well-supported?
- Completeness: Have you addressed all important aspects of the prompt?
- Actionability: Is your response practical and useful to the user?
- Clarity: Is your response well-organized and easy to follow?

Be specific and substantive. Do not hedge or equivocate without reason. Provide concrete analysis, not generic advice.`;

// --- Prompt Builders ---

function buildDraftUserPrompt(prompt: string, context?: string): string {
  let text = prompt;
  if (context) {
    text += `\n\n## Additional Context\n\n${context}`;
  }
  return text;
}
