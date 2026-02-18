import type { Provider } from "./types.js";

export const googleProvider: Provider = {
  name: "google",
  async draft(_config, _request) {
    // TODO: implement with @google/generative-ai SDK
    return { success: false, error: "not implemented" };
  },
};
