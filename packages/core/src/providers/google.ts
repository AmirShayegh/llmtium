import type { Provider } from "./types.js";

export const googleProvider: Provider = {
  meta: { id: "google", name: "Google", defaultModel: "gemini-2.0-flash" },
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
