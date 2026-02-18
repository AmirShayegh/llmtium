export interface ProviderMeta {
  id: string;
  name: string;
  defaultModel: string;
}

export interface ProviderConfig {
  apiKey: string;
  model?: string;
}

export interface DraftRequest {
  userPrompt: string;
  systemPrompt?: string;
}

export interface DraftResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export interface StructuredRequest {
  userPrompt: string;
  systemPrompt: string;
  schema: JsonSchema;
  toolName: string;
  toolDescription: string;
}

export type JsonSchema = Record<string, unknown>;

export type ProviderResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface Provider {
  meta: ProviderMeta;
  draft(
    config: ProviderConfig,
    request: DraftRequest,
  ): Promise<ProviderResult<DraftResponse>>;
  structuredOutput<T>(
    config: ProviderConfig,
    request: StructuredRequest,
  ): Promise<ProviderResult<T>>;
  validateKey(
    config: ProviderConfig,
  ): Promise<ProviderResult<boolean>>;
}
