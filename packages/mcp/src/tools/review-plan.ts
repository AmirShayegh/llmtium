import {
  reviewPlan,
  anthropicProvider,
  openaiProvider,
  googleProvider,
} from "@llmtium/core";
import type { ProviderWithConfig } from "@llmtium/core";
import { formatWorkflowResult } from "../format.js";

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: true;
}

const PROVIDER_REGISTRY: Record<string, { provider: typeof anthropicProvider; envKey: string }> = {
  anthropic: { provider: anthropicProvider, envKey: "ANTHROPIC_API_KEY" },
  openai: { provider: openaiProvider, envKey: "OPENAI_API_KEY" },
  google: { provider: googleProvider, envKey: "GOOGLE_API_KEY" },
};

function getEnvKey(envKey: string): string | undefined {
  const val = process.env[envKey]?.trim();
  return val || undefined;
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

interface HandleReviewPlanInput {
  plan: string;
  context?: string;
  models?: string[];
  synthesizer?: string;
}

export async function handleReviewPlan(input: HandleReviewPlanInput): Promise<ToolResult> {
  try {
    const { plan, context, models: requestedModels, synthesizer: requestedSynthesizer } = input;

    // Resolve providers
    let providerConfigs: ProviderWithConfig[];

    if (requestedModels !== undefined) {
      if (requestedModels.length === 0) {
        return errorResult("models array must not be empty. Omit the parameter to use all available providers.");
      }
      // Validate and resolve requested models
      const uniqueModels = [...new Set(requestedModels)];
      const missing: string[] = [];

      for (const id of uniqueModels) {
        const entry = PROVIDER_REGISTRY[id];
        if (!entry) {
          return errorResult(`Unknown provider: ${id}. Valid providers: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`);
        }
        if (!getEnvKey(entry.envKey)) {
          missing.push(`${id} (${entry.envKey})`);
        }
      }

      if (missing.length > 0) {
        return errorResult(`Missing API keys for requested providers: ${missing.join(", ")}`);
      }

      providerConfigs = uniqueModels.map((id) => {
        const entry = PROVIDER_REGISTRY[id]!;
        return {
          provider: entry.provider,
          config: { apiKey: getEnvKey(entry.envKey)! },
        };
      });
    } else {
      // Use all providers with env keys set
      providerConfigs = [];
      for (const [, entry] of Object.entries(PROVIDER_REGISTRY)) {
        const key = getEnvKey(entry.envKey);
        if (key) {
          providerConfigs.push({
            provider: entry.provider,
            config: { apiKey: key },
          });
        }
      }
    }

    if (providerConfigs.length < 2) {
      return errorResult(
        `Need at least 2 providers with API keys configured. Found ${providerConfigs.length}. ` +
        `Set environment variables: ${Object.values(PROVIDER_REGISTRY).map((e) => e.envKey).join(", ")}`
      );
    }

    // Resolve synthesizer
    const synthesizerId = requestedSynthesizer ?? "anthropic";
    const synthEntry = PROVIDER_REGISTRY[synthesizerId];
    if (!synthEntry) {
      return errorResult(`Unknown synthesizer: ${synthesizerId}. Valid providers: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`);
    }
    const synthKey = getEnvKey(synthEntry.envKey);
    if (!synthKey) {
      return errorResult(`Missing API key for synthesizer ${synthesizerId} (${synthEntry.envKey})`);
    }

    const synthesizer: ProviderWithConfig = {
      provider: synthEntry.provider,
      config: { apiKey: synthKey },
    };

    // Run the workflow
    const result = await reviewPlan({
      plan,
      context,
      providers: providerConfigs,
      synthesizer,
    });

    // Format and return
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
