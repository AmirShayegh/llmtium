import {
  anthropicProvider,
  openaiProvider,
  googleProvider,
} from "@llmtium/core";
import type { ProviderWithConfig } from "@llmtium/core";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: true;
}

export const PROVIDER_REGISTRY: Record<string, { provider: typeof anthropicProvider; envKey: string }> = {
  anthropic: { provider: anthropicProvider, envKey: "ANTHROPIC_API_KEY" },
  openai: { provider: openaiProvider, envKey: "OPENAI_API_KEY" },
  google: { provider: googleProvider, envKey: "GOOGLE_API_KEY" },
};

export function getEnvKey(envKey: string): string | undefined {
  const val = process.env[envKey]?.trim();
  return val || undefined;
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function resolveProviders(requestedModels?: string[]): ProviderWithConfig[] | ToolResult {
  if (requestedModels !== undefined) {
    if (requestedModels.length === 0) {
      return errorResult("models array must not be empty. Omit the parameter to use all available providers.");
    }
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

    return uniqueModels.map((id) => {
      const entry = PROVIDER_REGISTRY[id]!;
      return {
        provider: entry.provider,
        config: { apiKey: getEnvKey(entry.envKey)! },
      };
    });
  }

  // Use all providers with env keys set
  const configs: ProviderWithConfig[] = [];
  for (const [, entry] of Object.entries(PROVIDER_REGISTRY)) {
    const key = getEnvKey(entry.envKey);
    if (key) {
      configs.push({
        provider: entry.provider,
        config: { apiKey: key },
      });
    }
  }
  return configs;
}

export function resolveSynthesizer(requestedSynthesizer?: string): ProviderWithConfig | ToolResult {
  const synthesizerId = requestedSynthesizer ?? "anthropic";
  const synthEntry = PROVIDER_REGISTRY[synthesizerId];
  if (!synthEntry) {
    return errorResult(`Unknown synthesizer: ${synthesizerId}. Valid providers: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`);
  }
  const synthKey = getEnvKey(synthEntry.envKey);
  if (!synthKey) {
    return errorResult(`Missing API key for synthesizer ${synthesizerId} (${synthEntry.envKey})`);
  }
  return {
    provider: synthEntry.provider,
    config: { apiKey: synthKey },
  };
}

export function envKeyList(): string {
  return Object.values(PROVIDER_REGISTRY).map((e) => e.envKey).join(", ");
}

export function isError(result: unknown): result is ToolResult {
  return typeof result === "object" && result !== null && "isError" in result && "content" in result;
}
