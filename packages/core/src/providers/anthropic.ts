import type { Provider } from "./types.js";

export const anthropicProvider: Provider = {
  name: "anthropic",
  async draft(_config, _request) {
    // TODO: implement with @anthropic-ai/sdk
    return { success: false, error: "not implemented" };
  },
};
