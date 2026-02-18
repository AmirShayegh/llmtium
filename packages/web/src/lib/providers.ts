import {
  anthropicProvider,
  openaiProvider,
  googleProvider,
} from "@llmtium/core";
import type { Provider, ProviderWithConfig } from "@llmtium/core";

const PROVIDER_MAP: Record<string, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
};

export function resolveProvider(providerId: string): Provider | undefined {
  return PROVIDER_MAP[providerId];
}

export function toProviderWithConfig(
  providerId: string,
  apiKey: string,
  model?: string,
): ProviderWithConfig {
  const provider = PROVIDER_MAP[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  return { provider, config: { apiKey, model } };
}
