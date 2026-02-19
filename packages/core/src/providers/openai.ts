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
import {
  getOpenAIReasoningConfig,
  isThinkingRejection,
  withThinkingFallback,
  OPENAI_REASONING_PATTERN,
} from "./thinking.js";

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

function extractNonStreamResponse(
  response: OpenAI.ChatCompletion,
  model: string,
  start: number,
): DraftResponse {
  return {
    content: response.choices[0]?.message?.content ?? "",
    model,
    tokensIn: response.usage?.prompt_tokens ?? 0,
    tokensOut: response.usage?.completion_tokens ?? 0,
    durationMs: Date.now() - start,
  };
}

async function collectStream(
  stream: AsyncIterable<OpenAI.ChatCompletionChunk>,
  model: string,
  start: number,
): Promise<DraftResponse> {
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
}

async function draft(
  config: ProviderConfig,
  request: DraftRequest,
): Promise<ProviderResult<DraftResponse>> {
  const start = Date.now();
  try {
    const client = createClient(config.apiKey);
    const model = config.model ?? DEFAULT_MODEL;
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.userPrompt });

    const reasoningConfig = getOpenAIReasoningConfig(model);
    const modelSupportsStreaming = reasoningConfig?.supportsStreaming ?? true;
    const reasoningEffort = reasoningConfig?.reasoningEffort;

    // Thinking fallback wraps outside transient retry so each branch
    // gets its own transient retry protection.
    const data = await withThinkingFallback(
      reasoningConfig != null,
      OPENAI_REASONING_PATTERN,
      () => {
        if (!modelSupportsStreaming) {
          // o3: non-streaming with reasoning + transient retry
          return withTransientRetry(async () => {
            const response = await client.chat.completions.create({
              model,
              messages,
              reasoning_effort: reasoningEffort,
            });
            return extractNonStreamResponse(
              response as OpenAI.ChatCompletion,
              model,
              start,
            );
          });
        }
        // o4-mini: streaming with reasoning + transient retry
        return withTransientRetry(async () => {
          const stream = await client.chat.completions.create({
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            reasoning_effort: reasoningEffort,
          });
          return collectStream(stream, model, start);
        });
      },
      () => {
        if (!modelSupportsStreaming) {
          // o3 fallback: still non-streaming, just without reasoning_effort
          return withTransientRetry(async () => {
            const response = await client.chat.completions.create({
              model,
              messages,
            });
            return extractNonStreamResponse(
              response as OpenAI.ChatCompletion,
              model,
              start,
            );
          });
        }
        // Standard streaming path
        return withTransientRetry(async () => {
          const stream = await client.chat.completions.create({
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          });
          return collectStream(stream, model, start);
        });
      },
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
  const client = createClient(config.apiKey);
  const model = config.model ?? DEFAULT_MODEL;
  const reasoningConfig = getOpenAIReasoningConfig(model);
  let useReasoning = reasoningConfig != null;

  return withStructuredRetry<T>(async (retryPrompt) => {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: request.systemPrompt },
    ];
    const userContent = retryPrompt
      ? `${request.userPrompt}\n\n${retryPrompt}`
      : request.userPrompt;
    messages.push({ role: "user", content: userContent });

    // Mutable useReasoning flag persists across structured retries so a
    // thinking rejection on attempt 1 doesn't re-trigger on attempts 2–3.
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
          ...(useReasoning && reasoningConfig
            ? { reasoning_effort: reasoningConfig.reasoningEffort }
            : {}),
        }),
      );
    } catch (error) {
      if (useReasoning && isThinkingRejection(error, OPENAI_REASONING_PATTERN)) {
        useReasoning = false;
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
      } else {
        throw new Error(formatError(error));
      }
    }

    const content = (response as OpenAI.ChatCompletion).choices[0]?.message
      ?.content;
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
