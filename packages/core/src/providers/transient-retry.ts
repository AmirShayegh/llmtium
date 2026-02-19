const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const CONNECTION_ERROR_CODES = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EPIPE"];

type DelayFn = (ms: number) => Promise<void>;

const defaultDelay: DelayFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // 1. Node.js error codes (most reliable for connection errors)
  if (
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (CONNECTION_ERROR_CODES.includes(code)) return true;
  }

  // 2. SDK error class names (Anthropic/OpenAI APIConnectionError)
  if (error.name.includes("ConnectionError")) return true;

  // 3. Connection error patterns in message (Google SDK fallback)
  const msg = error.message;
  for (const pattern of CONNECTION_ERROR_CODES) {
    if (msg.includes(pattern)) return true;
  }

  // 4. HTTP status codes via duck typing
  if (
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return TRANSIENT_STATUS_CODES.has((error as { status: number }).status);
  }

  return false;
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelayMs: number = BASE_DELAY_MS,
  delay: DelayFn = defaultDelay,
): Promise<T> {
  let lastError: unknown;
  const retries = Math.max(0, maxRetries);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientError(error)) throw error;
      lastError = error;
      if (attempt < retries) {
        await delay(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}
