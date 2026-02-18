import type { Provider } from "./types.js";

export const openaiProvider: Provider = {
  name: "openai",
  async draft(_config, _request) {
    // TODO: implement with openai SDK
    return { success: false, error: "not implemented" };
  },
};
