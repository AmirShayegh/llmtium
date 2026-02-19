import type { ProviderWithConfig, PipelineResult } from "../types/pipeline.js";
import type { WorkflowType, WorkflowInput, WorkflowResult } from "../types/workflow.js";

export function compositeId(pwc: ProviderWithConfig): string {
  return `${pwc.provider.meta.id}/${pwc.config.model ?? pwc.provider.meta.defaultModel}`;
}

export interface WorkflowResultInput {
  prompt: string;
  context?: string;
  workflow: WorkflowType;
  providers: ProviderWithConfig[];
  synthesizer: ProviderWithConfig;
}

export function toWorkflowResult(input: WorkflowResultInput, pipelineResult: PipelineResult): WorkflowResult {
  const workflowInput: WorkflowInput = {
    prompt: input.prompt,
    context: input.context,
    workflow: input.workflow,
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
