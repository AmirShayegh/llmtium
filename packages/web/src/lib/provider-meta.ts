// Client-safe provider metadata — no SDK imports.
// For server-only provider instances, use lib/providers.ts instead.

export interface ProviderModelOption {
  id: string;    // model ID passed to SDK
  label: string; // display name
}

export interface ProviderMetaEntry {
  name: string;
  defaultModel: string;
  models: ProviderModelOption[];
}

export const PROVIDER_META: Record<string, ProviderMetaEntry> = {
  anthropic: {
    name: "Anthropic",
    defaultModel: "claude-opus-4-6",
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  openai: {
    name: "OpenAI",
    defaultModel: "gpt-5.2",
    models: [
      { id: "gpt-5.2", label: "GPT-5.2" },
      { id: "gpt-5.1", label: "GPT-5.1" },
      { id: "gpt-5-mini", label: "GPT-5 Mini" },
      { id: "o3", label: "o3" },
      { id: "o4-mini", label: "o4 Mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
    ],
  },
  google: {
    name: "Google",
    defaultModel: "gemini-2.5-flash",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
      { id: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
    ],
  },
};
