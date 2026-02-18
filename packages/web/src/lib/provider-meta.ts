// Client-safe provider metadata — no SDK imports.
// For server-only provider instances, use lib/providers.ts instead.

export const PROVIDER_META: Record<string, { name: string; defaultModel: string }> = {
  anthropic: { name: "Anthropic", defaultModel: "claude-sonnet-4-20250514" },
  openai: { name: "OpenAI", defaultModel: "gpt-4o" },
  google: { name: "Google", defaultModel: "gemini-2.0-flash" },
};
