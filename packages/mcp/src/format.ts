import type { WorkflowResult, PipelineError } from "@llmtium/core";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSuccess(result: WorkflowResult): string {
  const synthesis = result.stages.synthesis;
  const lines: string[] = [];

  if (!synthesis) {
    lines.push("=== SYNTHESIS ===", "", "No synthesis was produced.", "");
  } else {
    lines.push("=== SYNTHESIS ===", "", synthesis.output, "");

    if (synthesis.resolved_disagreements.length > 0) {
      lines.push("=== RESOLVED DISAGREEMENTS ===", "");
      for (let i = 0; i < synthesis.resolved_disagreements.length; i++) {
        const d = synthesis.resolved_disagreements[i]!;
        lines.push(`${i + 1}. ${d.topic}`);
        lines.push(`   Position: ${d.chosen_position}`);
        lines.push(`   Rationale: ${d.rationale}`);
        lines.push(`   Supporting: ${d.supporting_responses.join(", ")}`);
        lines.push("");
      }
    }

    if (synthesis.open_questions.length > 0) {
      lines.push("=== OPEN QUESTIONS ===", "");
      for (const q of synthesis.open_questions) {
        lines.push(`- ${q}`);
      }
      lines.push("");
    }

    if (synthesis.action_items.length > 0) {
      lines.push("=== ACTION ITEMS ===", "");
      for (const item of synthesis.action_items) {
        lines.push(`[${item.priority}] ${item.item}`);
      }
      lines.push("");
    }

    lines.push("=== CONFIDENCE ===", "");
    lines.push(`${synthesis.confidence.toFixed(2)} \u2014 ${synthesis.confidence_reason}`);
    lines.push("");
  }

  if (result.status === "partial" && result.errors.length > 0) {
    lines.push("=== WARNINGS ===", "");
    lines.push(...formatErrorLines(result.errors));
    lines.push("");
  }

  lines.push("=== TELEMETRY ===", "");
  lines.push(`Duration: ${formatDuration(result.telemetry.totalDurationMs)} | Models: ${result.input.models.join(", ")}`);
  lines.push("");

  return lines.join("\n");
}

function formatErrorLines(errors: PipelineError[]): string[] {
  return errors.map((e) => `- [${e.stage}] ${e.model}: ${e.error}`);
}

function formatFailed(result: WorkflowResult): string {
  const lines = [
    "Deliberation pipeline failed.",
    "",
  ];

  if (result.errors.length > 0) {
    lines.push("Errors:");
    lines.push(...formatErrorLines(result.errors));
  } else {
    lines.push("No error details available.");
  }

  lines.push("");
  return lines.join("\n");
}

export function formatWorkflowResult(result: WorkflowResult): string {
  if (result.status === "failed") {
    return formatFailed(result);
  }
  return formatSuccess(result);
}
