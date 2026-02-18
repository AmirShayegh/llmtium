import type { ProviderResult } from "./types.js";

const MAX_RETRIES = 2;

export const RETRY_PROMPT =
  "Your previous response was not valid JSON. Respond with ONLY the JSON object, no other text.";

export async function withStructuredRetry<T>(
  attemptFn: (retryPrompt?: string) => Promise<string>,
): Promise<ProviderResult<T>> {
  let lastError: string = "Unknown error";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const raw = await attemptFn(attempt > 0 ? RETRY_PROMPT : undefined);
      const data = JSON.parse(raw) as T;
      return { success: true, data };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    success: false,
    error: `Structured output failed after ${MAX_RETRIES} attempts: ${lastError}`,
  };
}
