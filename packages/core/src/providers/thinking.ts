// ---------------------------------------------------------------------------
// Local types — avoids deep SDK imports that break on minor version bumps.
// Compile-time safety: anthropic.ts passes these values to SDK methods that
// expect ThinkingConfigParam, so TypeScript structural typing catches drift.
// ---------------------------------------------------------------------------

export type AnthropicThinkingConfig =
  | { type: "enabled"; budget_tokens: number }
  | { type: "adaptive" }
  | { type: "disabled" };

// ---------------------------------------------------------------------------
// Provider-specific rejection patterns
// ---------------------------------------------------------------------------

/** Anthropic: matches "thinking", "budget_tokens", "budget tokens" */
export const ANTHROPIC_THINKING_PATTERN = /thinking|budget.?tokens/i;

/** OpenAI: matches "reasoning_effort", "reasoning effort" */
export const OPENAI_REASONING_PATTERN = /reasoning.?effort/i;

/** Google: matches "thinkingConfig", "thinkingBudget", "thinking_config", "thinking_budget" */
export const GOOGLE_THINKING_PATTERN = /thinking.?config|thinking.?budget/i;

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

const THINKING_MAX_TOKENS = 16384;

export function getAnthropicThinkingConfig(
  model: string,
): { thinking: AnthropicThinkingConfig; maxTokens: number } | null {
  // Claude 4.6 models (Opus, Sonnet) — adaptive thinking
  if (/^claude-(opus|sonnet)-4-6/.test(model)) {
    return { thinking: { type: "adaptive" }, maxTokens: THINKING_MAX_TOKENS };
  }
  // Claude 4.x (Haiku etc.) and Claude 3.7 — enabled with explicit budget
  if (/^claude-(opus|sonnet|haiku)-4/.test(model) || /^claude-3-7/.test(model)) {
    return {
      thinking: { type: "enabled", budget_tokens: 8192 },
      maxTokens: THINKING_MAX_TOKENS,
    };
  }
  return null;
}

export function getOpenAIReasoningConfig(
  model: string,
): { reasoningEffort: "medium"; supportsStreaming: boolean } | null {
  // o3, o3-mini — reasoning without streaming
  if (/^o3(?:-|$)/.test(model)) {
    return { reasoningEffort: "medium", supportsStreaming: false };
  }
  // o4-mini and other o-series — reasoning with streaming
  if (/^o\d/.test(model)) {
    return { reasoningEffort: "medium", supportsStreaming: true };
  }
  // gpt-5.x excluded from auto-reasoning (see design decision #2)
  return null;
}

/**
 * Gemini 2.5 models think by default regardless of whether thinkingConfig is
 * passed. This function configures the *budget* (auto/dynamic via -1), not
 * whether thinking happens.
 */
export function getGoogleThinkingConfig(
  model: string,
): { thinkingBudget: number } | null {
  if (/^gemini-2\.5/.test(model) || /^gemini-3/.test(model)) {
    return { thinkingBudget: -1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Thinking rejection detection
// ---------------------------------------------------------------------------

/**
 * Checks if an error is a 400 rejection of thinking/reasoning parameters.
 * Uses a provider-specific pattern to avoid catching generic 400s.
 */
export function isThinkingRejection(
  error: unknown,
  pattern: RegExp,
): boolean {
  if (error == null || typeof error !== "object") return false;
  if (
    !("status" in error) ||
    (error as { status: unknown }).status !== 400
  ) {
    return false;
  }
  if (
    !("message" in error) ||
    typeof (error as { message: unknown }).message !== "string"
  ) {
    return false;
  }
  return pattern.test((error as { message: string }).message);
}

// ---------------------------------------------------------------------------
// Thinking fallback utility
// ---------------------------------------------------------------------------

/**
 * Wraps a thinking-enabled API call with fail-open fallback.
 *
 * If `thinkingEnabled` is false, calls `attemptWithoutThinking` directly.
 * If true, tries `attemptWithThinking` first. On a thinking rejection (400
 * matching `rejectionPattern`), falls back to `attemptWithoutThinking`.
 * All other errors propagate unchanged.
 *
 * Should wrap OUTSIDE `withTransientRetry` so each branch gets its own
 * transient retry protection.
 */
export async function withThinkingFallback<T>(
  thinkingEnabled: boolean,
  rejectionPattern: RegExp,
  attemptWithThinking: () => Promise<T>,
  attemptWithoutThinking: () => Promise<T>,
): Promise<T> {
  if (!thinkingEnabled) return attemptWithoutThinking();
  try {
    return await attemptWithThinking();
  } catch (error) {
    if (isThinkingRejection(error, rejectionPattern)) {
      return attemptWithoutThinking();
    }
    throw error;
  }
}
