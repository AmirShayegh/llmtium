import { general } from "@llmtium/core";
import { formatWorkflowResult } from "../format.js";
import {
  resolveProviders,
  resolveSynthesizer,
  isError,
  errorResult,
  textResult,
  envKeyList,
} from "./shared.js";
import type { ToolResult } from "./shared.js";

interface HandleDeliberateInput {
  prompt: string;
  context?: string;
  models?: string[];
  synthesizer?: string;
}

export async function handleDeliberate(input: HandleDeliberateInput): Promise<ToolResult> {
  try {
    const { prompt, context, models: requestedModels, synthesizer: requestedSynthesizer } = input;

    const providers = resolveProviders(requestedModels);
    if (isError(providers)) return providers;

    if (providers.length < 2) {
      return errorResult(
        `Need at least 2 providers with API keys configured. Found ${providers.length}. ` +
        `Set environment variables: ${envKeyList()}`
      );
    }

    const synthesizer = resolveSynthesizer(requestedSynthesizer);
    if (isError(synthesizer)) return synthesizer;

    const result = await general({
      prompt,
      context,
      providers,
      synthesizer,
    });

    const formatted = formatWorkflowResult(result);

    if (result.status === "failed") {
      return errorResult(formatted);
    }

    return textResult(formatted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Internal error: ${message}`);
  }
}
