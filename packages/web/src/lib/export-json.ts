import type { CrossReview, SynthesisResponse, PipelineError } from "@llmtium/core";
import type { SerializedWorkflowResult } from "./serialize";

export interface ExportData {
  prompt: string;
  models: string[];
  synthesizer: string;
  drafts: Record<string, string>;
  reviews: Record<string, CrossReview>;
  synthesis: SynthesisResponse;
  mapping: Record<string, string> | null;
  result: SerializedWorkflowResult;
  errors: PipelineError[];
}

export function exportToJson(data: ExportData): string {
  return JSON.stringify(
    {
      _meta: {
        generator: "LLMtium \u2014 Multi-LLM Deliberation Tool",
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      prompt: data.prompt,
      pipeline: data.result.pipeline,
    },
    null,
    2,
  );
}
