export interface ProviderConfig {
  apiKey: string;
  model?: string;
}

export interface DraftRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface DraftResponse {
  content: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
}

export type ProviderResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface Provider {
  name: string;
  draft(config: ProviderConfig, request: DraftRequest): Promise<ProviderResult<DraftResponse>>;
}
