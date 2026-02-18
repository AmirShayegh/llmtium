import type { ProviderResult } from "./types.js";

const MAX_ATTEMPTS = 3;

export const RETRY_PROMPT =
  "Your previous response was not valid JSON. Respond with ONLY the JSON object, no other text.";

export async function withStructuredRetry<T>(
  attemptFn: (retryPrompt?: string) => Promise<string>,
): Promise<ProviderResult<T>> {
  let lastError: string = "Unknown error";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await attemptFn(attempt > 0 ? RETRY_PROMPT : undefined);
    } catch (error) {
      // API errors (auth, rate limit, network) — fail immediately, no retry
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const data = JSON.parse(raw) as T;
      return { success: true, data };
    } catch {
      lastError = `Invalid JSON: ${raw.slice(0, 100)}`;
    }
  }

  return {
    success: false,
    error: `Structured output failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
  };
}
