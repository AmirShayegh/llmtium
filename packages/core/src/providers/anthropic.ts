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

const DEFAULT_MODEL = "claude-opus-4-6";
const MAX_TOKENS = 8192;

function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

function formatError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Invalid API key";
  if (error instanceof Anthropic.RateLimitError) return "Rate limit exceeded";
  if (error instanceof Anthropic.APIConnectionError) return "Connection failed";
  if (error instanceof Anthropic.APIError)
    return `API error (${error.status}): ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function draft(
  config: ProviderConfig,
  request: DraftRequest,
): Promise<ProviderResult<DraftResponse>> {
  const start = Date.now();
  try {
    const client = createClient(config.apiKey);
    const model = config.model ?? DEFAULT_MODEL;
    const stream = client.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system: request.systemPrompt ?? "",
      messages: [{ role: "user", content: request.userPrompt }],
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
      success: true,
      data: {
        content,
        model,
        tokensIn: final.usage.input_tokens,
        tokensOut: final.usage.output_tokens,
        durationMs: Date.now() - start,
      },
    };
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
    const userContent = retryPrompt
      ? `${request.userPrompt}\n\n${retryPrompt}`
      : request.userPrompt;

    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: request.systemPrompt,
        messages: [{ role: "user", content: userContent }],
        tools: [
          {
            name: request.toolName,
            description: request.toolDescription,
            input_schema: request.schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool" as const, name: request.toolName },
      });
    } catch (error) {
      throw new Error(formatError(error));
    }

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolBlock) {
      // Malformed response — return non-JSON to trigger retry
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
