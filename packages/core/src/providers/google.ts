import { GoogleGenAI } from "@google/genai";
import type {
  Provider,
  ProviderConfig,
  DraftRequest,
  DraftResponse,
  StructuredRequest,
  ProviderResult,
} from "./types.js";
import { withStructuredRetry } from "./structured-retry.js";
import { withTransientRetry } from "./transient-retry.js";
import {
  getGoogleThinkingConfig,
  isThinkingRejection,
  withThinkingFallback,
  GOOGLE_THINKING_PATTERN,
} from "./thinking.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Try to extract a human-readable message from Google SDK's nested JSON errors. */
function extractProviderMessage(msg: string): string | null {
  try {
    const parsed = JSON.parse(msg);
    const inner = parsed?.error?.message;
    if (typeof inner === "string") {
      try {
        const deep = JSON.parse(inner);
        if (typeof deep?.error?.message === "string") return deep.error.message;
      } catch { /* inner is already plain text */ }
      return inner;
    }
  } catch { /* not JSON */ }
  return null;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const msg = error.message;
  // Check connection errors first — SDK's APIConnectionError has status=undefined
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT"))
    return "Connection failed";
  // Then check API status codes (only if status is a number)
  if (
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    if (status === 401 || status === 403) return "Invalid API key";
    if (status === 429) return "Rate limit exceeded";
    return extractProviderMessage(msg) ?? `API error (${status}): ${msg}`;
  }
  return msg;
}

async function streamDraftImpl(
  ai: GoogleGenAI,
  modelName: string,
  request: DraftRequest,
  start: number,
  thinkingConfig?: { thinkingBudget: number },
): Promise<DraftResponse> {
  const response = await ai.models.generateContentStream({
    model: modelName,
    contents: request.userPrompt,
    config: {
      ...(request.systemPrompt
        ? { systemInstruction: request.systemPrompt }
        : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  });

  let content = "";
  let tokensIn = 0;
  let tokensOut = 0;
  for await (const chunk of response) {
    content += chunk.text ?? "";
    if (chunk.usageMetadata) {
      tokensIn = chunk.usageMetadata.promptTokenCount ?? 0;
      tokensOut = chunk.usageMetadata.candidatesTokenCount ?? 0;
    }
  }

  return {
    content,
    model: modelName,
    tokensIn,
    tokensOut,
    durationMs: Date.now() - start,
  };
}

async function draft(
  config: ProviderConfig,
  request: DraftRequest,
): Promise<ProviderResult<DraftResponse>> {
  const start = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const modelName = config.model ?? DEFAULT_MODEL;

    // Gemini 2.5 models think by default regardless of whether thinkingConfig
    // is passed. This configures the budget (auto/dynamic via -1), not whether
    // thinking happens.
    const thinkingConfig = getGoogleThinkingConfig(modelName);

    // Thinking fallback wraps outside transient retry so each branch
    // gets its own transient retry protection.
    const data = await withThinkingFallback(
      thinkingConfig != null,
      GOOGLE_THINKING_PATTERN,
      () =>
        withTransientRetry(() =>
          streamDraftImpl(ai, modelName, request, start, thinkingConfig ?? undefined),
        ),
      () =>
        withTransientRetry(() =>
          streamDraftImpl(ai, modelName, request, start),
        ),
    );

    return { success: true, data };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

async function structuredOutput<T>(
  config: ProviderConfig,
  request: StructuredRequest,
): Promise<ProviderResult<T>> {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const modelName = config.model ?? DEFAULT_MODEL;
  const thinkingConfig = getGoogleThinkingConfig(modelName);
  let useThinking = thinkingConfig != null;

  return withStructuredRetry<T>(async (retryPrompt) => {
    const userContent = retryPrompt
      ? `${request.userPrompt}\n\n${retryPrompt}`
      : request.userPrompt;

    // Mutable useThinking flag persists across structured retries so a
    // thinking rejection on attempt 1 doesn't re-trigger on attempts 2–3.
    let result;
    try {
      result = await withTransientRetry(() =>
        ai.models.generateContent({
          model: modelName,
          contents: userContent,
          config: {
            systemInstruction: request.systemPrompt,
            responseMimeType: "application/json",
            responseJsonSchema: request.schema,
            ...(useThinking && thinkingConfig
              ? { thinkingConfig }
              : {}),
          },
        }),
      );
    } catch (error) {
      if (useThinking && isThinkingRejection(error, GOOGLE_THINKING_PATTERN)) {
        useThinking = false;
        result = await withTransientRetry(() =>
          ai.models.generateContent({
            model: modelName,
            contents: userContent,
            config: {
              systemInstruction: request.systemPrompt,
              responseMimeType: "application/json",
              responseJsonSchema: request.schema,
            },
          }),
        );
      } else {
        throw new Error(formatError(error));
      }
    }

    // Empty text is a malformed response — return empty to trigger retry
    return result.text ?? "";
  });
}

async function validateKey(
  config: ProviderConfig,
): Promise<ProviderResult<boolean>> {
  try {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    await ai.models.generateContent({
      model: config.model ?? DEFAULT_MODEL,
      contents: "hi",
    });
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export const googleProvider: Provider = {
  meta: { id: "google", name: "Google", defaultModel: DEFAULT_MODEL },
  draft,
  structuredOutput,
  validateKey,
};
