import type { WorkflowResult, PipelineResult } from "@llmtium/core";

export interface SerializedWorkflowResult {
  status: WorkflowResult["status"];
  input: WorkflowResult["input"];
  stages: {
    drafts: Record<string, unknown>;
    reviews: Record<string, unknown>;
    synthesis: WorkflowResult["stages"]["synthesis"];
    mapping: Record<string, string> | null;
  };
  errors: WorkflowResult["errors"];
  telemetry: WorkflowResult["telemetry"];
  pipeline: {
    status: PipelineResult["status"];
    drafts: Record<string, unknown>;
    reviews: Record<string, unknown>;
    synthesis: PipelineResult["synthesis"];
    mapping: Record<string, string> | null;
    errors: PipelineResult["errors"];
    telemetry: PipelineResult["telemetry"];
  };
}

function mapToRecord<V>(map: Map<string, V> | null): Record<string, V> | null {
  if (!map) return null;
  const result: Record<string, V> = {};
  for (const [key, value] of map) {
    result[key] = value;
  }
  return result;
}

export function serializeWorkflowResult(result: WorkflowResult): SerializedWorkflowResult {
  return {
    status: result.status,
    input: result.input,
    stages: {
      drafts: mapToRecord(result.stages.drafts) ?? {},
      reviews: mapToRecord(result.stages.reviews) ?? {},
      synthesis: result.stages.synthesis,
      mapping: mapToRecord(result.stages.mapping),
    },
    errors: result.errors,
    telemetry: result.telemetry,
    pipeline: {
      status: result.pipeline.status,
      drafts: mapToRecord(result.pipeline.drafts) ?? {},
      reviews: mapToRecord(result.pipeline.reviews) ?? {},
      synthesis: result.pipeline.synthesis,
      mapping: mapToRecord(result.pipeline.mapping),
      errors: result.pipeline.errors,
      telemetry: result.pipeline.telemetry,
    },
  };
}
