import OpenAI from "openai";
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

const DEFAULT_MODEL = "gpt-5.2";

function createClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

function formatError(error: unknown): string {
  if (error instanceof OpenAI.APIError && error.status === 401)
    return "Invalid API key";
  if (error instanceof OpenAI.RateLimitError) return "Rate limit exceeded";
  if (error instanceof OpenAI.APIConnectionError) return "Connection failed";
  if (error instanceof OpenAI.APIError) {
    return `API error (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function draft(
  config: ProviderConfig,
  request: DraftRequest,
): Promise<ProviderResult<DraftResponse>> {
  try {
    const client = createClient(config.apiKey);
    const model = config.model ?? DEFAULT_MODEL;
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.userPrompt });

    const data = await withTransientRetry(async () => {
      const start = Date.now();
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = "";
      let tokensIn = 0;
      let tokensOut = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) content += delta;
        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens;
          tokensOut = chunk.usage.completion_tokens;
        }
      }

      return { content, model, tokensIn, tokensOut, durationMs: Date.now() - start };
    });

    return { success: true, data };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

async function structuredOutput<T>(
  config: ProviderConfig,
  request: StructuredRequest,
): Promise<ProviderResult<T>> {
  const client = createClient(config.apiKey);
  const model = config.model ?? DEFAULT_MODEL;

  return withStructuredRetry<T>(async (retryPrompt) => {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: request.systemPrompt },
    ];
    const userContent = retryPrompt
      ? `${request.userPrompt}\n\n${retryPrompt}`
      : request.userPrompt;
    messages.push({ role: "user", content: userContent });

    // Transient retry (429/5xx/connection) nests inside structured retry (JSON parse).
    // Worst case: 3 structured × 3 transient = 9 API calls.
    let response;
    try {
      response = await withTransientRetry(() =>
        client.chat.completions.create({
          model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.toolName,
              schema: request.schema,
              strict: true,
            },
          },
        }),
      );
    } catch (error) {
      throw new Error(formatError(error));
    }

    const content = response.choices[0]?.message?.content;
    // Null/empty content is a malformed response — return empty to trigger retry
    return content ?? "";
  });
}

async function validateKey(
  config: ProviderConfig,
): Promise<ProviderResult<boolean>> {
  try {
    const client = createClient(config.apiKey);
    await client.models.list();
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export const openaiProvider: Provider = {
  meta: { id: "openai", name: "OpenAI", defaultModel: DEFAULT_MODEL },
  draft,
  structuredOutput,
  validateKey,
};
