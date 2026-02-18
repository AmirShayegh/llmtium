import type { Provider } from "./types.js";

export const openaiProvider: Provider = {
  meta: { id: "openai", name: "OpenAI", defaultModel: "gpt-4o" },
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
