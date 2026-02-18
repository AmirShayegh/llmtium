import type { Provider } from "./types.js";

export const anthropicProvider: Provider = {
  meta: { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-20250514" },
  async draft(_config, _request) {
    return { success: false, error: "not implemented" };
  },
  async structuredOutput(_config, _request) {
    return { success: false, error: "not implemented" };
  },
  async validateKey(_config) {
    return { success: false, error: "not implemented" };
  },
};
