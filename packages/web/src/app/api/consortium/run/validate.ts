const VALID_PROVIDERS = new Set(["anthropic", "openai", "google"]);

export function validateRunRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Request body must be an object";

  const req = body as Record<string, unknown>;

  if (typeof req.prompt !== "string" || req.prompt.trim().length === 0) {
    return "prompt is required and must be a non-empty string";
  }

  if (req.context !== undefined && typeof req.context !== "string") {
    return "context must be a string if provided";
  }

  if (!Array.isArray(req.models) || req.models.length < 2) {
    return "models must be an array with at least 2 entries";
  }

  const seenProviders = new Set<string>();
  for (const model of req.models) {
    if (typeof model !== "string") return "Each model must be a string provider ID";
    if (!VALID_PROVIDERS.has(model)) return `Unknown provider: ${model}`;
    if (seenProviders.has(model)) return `Duplicate provider: ${model}`;
    seenProviders.add(model);
  }

  if (typeof req.synthesizer !== "string") return "synthesizer is required";
  if (!VALID_PROVIDERS.has(req.synthesizer)) return `Unknown synthesizer provider: ${req.synthesizer}`;

  if (!req.apiKeys || typeof req.apiKeys !== "object") return "apiKeys is required";
  const keys = req.apiKeys as Record<string, unknown>;

  for (const model of req.models as string[]) {
    if (typeof keys[model] !== "string" || (keys[model] as string).trim().length === 0) {
      return `Missing or empty apiKey for provider: ${model}`;
    }
  }

  if (typeof keys[req.synthesizer] !== "string" || (keys[req.synthesizer] as string).trim().length === 0) {
    return `Missing or empty apiKey for synthesizer: ${req.synthesizer}`;
  }

  return null;
}
