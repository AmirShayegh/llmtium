import Anthropic from "@anthropic-ai/sdk";
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
  getAnthropicThinkingConfig,
  withThinkingFallback,
  isThinkingRejection,
  ANTHROPIC_THINKING_PATTERN,
} from "./thinking.js";
import type { AnthropicThinkingConfig } from "./thinking.js";

const DEFAULT_MODEL = "claude-opus-4-6";
const MAX_TOKENS = 8192;

function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

function formatError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Invalid API key";
  if (error instanceof Anthropic.RateLimitError) return "Rate limit exceeded";
  if (error instanceof Anthropic.APIConnectionError) return "Connection failed";
  if (error instanceof Anthropic.APIError) {
    return `API error (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function streamDraft(
  client: Anthropic,
  model: string,
  maxTokens: number,
  request: DraftRequest,
  start: number,
  thinking?: AnthropicThinkingConfig,
): Promise<DraftResponse> {
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: request.systemPrompt ?? "",
    messages: [{ role: "user", content: request.userPrompt }],
    ...(thinking ? { thinking } : {}),
  });

  let content = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      content += event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  return {
    content,
    model,
    tokensIn: final.usage.input_tokens,
    tokensOut: final.usage.output_tokens,
    durationMs: Date.now() - start,
  };
}

async function draft(
  config: ProviderConfig,
  request: DraftRequest,
): Promise<ProviderResult<DraftResponse>> {
  const start = Date.now();
  try {
    const client = createClient(config.apiKey);
    const model = config.model ?? DEFAULT_MODEL;
    const thinkingConfig = getAnthropicThinkingConfig(model);
    const thinkingMaxTokens = thinkingConfig?.maxTokens ?? MAX_TOKENS;
    const thinkingParam = thinkingConfig?.thinking;

    // Thinking fallback wraps outside transient retry so each branch
    // gets its own transient retry protection.
    const data = await withThinkingFallback(
      thinkingConfig != null,
      ANTHROPIC_THINKING_PATTERN,
      () =>
        withTransientRetry(() =>
          streamDraft(
            client,
            model,
            thinkingMaxTokens,
            request,
            start,
            thinkingParam,
          ),
        ),
      () =>
        withTransientRetry(() =>
          streamDraft(client, model, MAX_TOKENS, request, start),
        ),
    );

    return { success: true, data };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

function buildForcedToolParams(
  model: string,
  request: StructuredRequest,
  userContent: string,
) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: request.systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: [
      {
        name: request.toolName,
        description: request.toolDescription,
        input_schema: request.schema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool" as const, name: request.toolName },
  };
}

async function structuredOutput<T>(
  config: ProviderConfig,
  request: StructuredRequest,
): Promise<ProviderResult<T>> {
  const client = createClient(config.apiKey);
  const model = config.model ?? DEFAULT_MODEL;
  const thinkingConfig = getAnthropicThinkingConfig(model);
  const thinkingMaxTokens = thinkingConfig?.maxTokens ?? MAX_TOKENS;
  const thinkingParam = thinkingConfig?.thinking;
  let useThinking = thinkingConfig != null;

  // Thinking attempt with transient retries, then forced-tool retries
  // with transient protection if thinking+auto produces no tool_use block.
  return withStructuredRetry<T>(async (retryPrompt) => {
    const userContent = retryPrompt
      ? `${request.userPrompt}\n\n${retryPrompt}`
      : request.userPrompt;

    let response;
    try {
      response = await withTransientRetry(() =>
        useThinking
          ? client.messages.create({
              model,
              max_tokens: thinkingMaxTokens,
              system: request.systemPrompt,
              messages: [{ role: "user", content: userContent }],
              tools: [
                {
                  name: request.toolName,
                  description: request.toolDescription,
                  input_schema:
                    request.schema as Anthropic.Tool.InputSchema,
                },
              ],
              tool_choice: { type: "auto" as const },
              ...(thinkingParam ? { thinking: thinkingParam } : {}),
            })
          : client.messages.create(buildForcedToolParams(model, request, userContent)),
      );
    } catch (error) {
      if (useThinking && isThinkingRejection(error, ANTHROPIC_THINKING_PATTERN)) {
        useThinking = false;
        response = await withTransientRetry(() =>
          client.messages.create(buildForcedToolParams(model, request, userContent)),
        );
      } else {
        throw new Error(formatError(error));
      }
    }

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolBlock) {
      // auto didn't produce tool_use — disable thinking for remaining retries
      if (useThinking) useThinking = false;
      return "NO_TOOL_USE_BLOCK";
    }

    return JSON.stringify(toolBlock.input);
  });
}

async function validateKey(
  config: ProviderConfig,
): Promise<ProviderResult<boolean>> {
  try {
    const client = createClient(config.apiKey);
    await client.messages.create({
      model: config.model ?? DEFAULT_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export const anthropicProvider: Provider = {
  meta: { id: "anthropic", name: "Anthropic", defaultModel: DEFAULT_MODEL },
  draft,
  structuredOutput,
  validateKey,
};
