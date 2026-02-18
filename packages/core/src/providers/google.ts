import { GoogleGenerativeAI, type ResponseSchema } from "@google/generative-ai";
import type {
  Provider,
  ProviderConfig,
  DraftRequest,
  DraftResponse,
  StructuredRequest,
  ProviderResult,
} from "./types.js";
import { withStructuredRetry } from "./structured-retry.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const msg = error.message;
  if (msg.includes("API_KEY_INVALID") || msg.includes("401"))
    return "Invalid API key";
  if (msg.includes("429")) return "Rate limit exceeded";
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT"))
    return "Connection failed";
  return msg;
}

async function draft(
  config: ProviderConfig,
  request: DraftRequest,
): Promise<ProviderResult<DraftResponse>> {
  const start = Date.now();
  try {
    const modelName = config.model ?? DEFAULT_MODEL;
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      ...(request.systemPrompt
        ? { systemInstruction: request.systemPrompt }
        : {}),
    });

    const result = await model.generateContentStream(request.userPrompt);
    let content = "";
    for await (const chunk of result.stream) {
      content += chunk.text();
    }

    const response = await result.response;
    const usage = response.usageMetadata;

    return {
      success: true,
      data: {
        content,
        model: modelName,
        tokensIn: usage?.promptTokenCount ?? 0,
        tokensOut: usage?.candidatesTokenCount ?? 0,
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
  const modelName = config.model ?? DEFAULT_MODEL;
  const genAI = new GoogleGenerativeAI(config.apiKey);

  return withStructuredRetry<T>(async (retryPrompt) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: request.systemPrompt,
      generationConfig: {
        responseMimeType: "application/json",
        // Cast needed: our JsonSchema is a generic Record, Google SDK expects their typed Schema union
        responseSchema: request.schema as unknown as ResponseSchema,
      },
    });

    const userContent = retryPrompt
      ? `${request.userPrompt}\n\n${retryPrompt}`
      : request.userPrompt;

    const result = await model.generateContent(userContent);
    const text = result.response.text();
    if (!text) throw new Error("Empty response text");
    return text;
  });
}

async function validateKey(
  config: ProviderConfig,
): Promise<ProviderResult<boolean>> {
  try {
    const modelName = config.model ?? DEFAULT_MODEL;
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    await model.generateContent("hi");
    return { success: true, data: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("API_KEY_INVALID") || msg.includes("401")) {
      return { success: false, error: "Invalid API key" };
    }
    return { success: false, error: formatError(error) };
  }
}

export const googleProvider: Provider = {
  meta: { id: "google", name: "Google", defaultModel: DEFAULT_MODEL },
  draft,
  structuredOutput,
  validateKey,
};
