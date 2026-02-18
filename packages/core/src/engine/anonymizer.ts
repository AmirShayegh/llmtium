import type { AnonymizedResponse } from "../types/index.js";

const MAX_RESPONSES = 26;

/**
 * Anonymize model responses with randomized labels.
 *
 * Each call produces fresh randomized label assignments — the orchestrator
 * calls this once per round, so labels change between rounds.
 * Use shuffleForReviewer for per-reviewer ordering within a single round.
 */
export function anonymize(
  responses: Map<string, string>,
): { anonymized: AnonymizedResponse[]; mapping: Map<string, string> } {
  if (responses.size > MAX_RESPONSES) {
    throw new Error("Cannot anonymize more than 26 responses");
  }

  const modelIds = [...responses.keys()];
  const labels = modelIds.map((_, i) => `Response ${String.fromCharCode(65 + i)}`);

  // Fisher-Yates shuffle for randomized label assignment
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [labels[i], labels[j]] = [labels[j]!, labels[i]!];
  }

  const anonymized: AnonymizedResponse[] = [];
  const mapping = new Map<string, string>();

  for (let i = 0; i < modelIds.length; i++) {
    const modelId = modelIds[i]!;
    const label = labels[i]!;
    anonymized.push({ label, content: responses.get(modelId)! });
    mapping.set(label, modelId);
  }

  return { anonymized, mapping };
}

/**
 * Deterministic shuffle of anonymized responses for a specific reviewer.
 * Same reviewerId always produces the same ordering; different IDs differ.
 */
export function shuffleForReviewer(
  responses: AnonymizedResponse[],
  reviewerId: string,
): AnonymizedResponse[] {
  if (responses.length <= 1) return [...responses];

  const copy = [...responses];
  let seed = hashString(reviewerId);

  // Fisher-Yates shuffle with seeded PRNG
  for (let i = copy.length - 1; i > 0; i--) {
    seed = xorshift32(seed);
    const j = Math.abs(seed) % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }

  return copy;
}

/**
 * Recover the original model ID from an anonymized label.
 * Returns the label itself if not found in the mapping.
 */
export function deanonymize(
  label: string,
  mapping: Map<string, string>,
): string {
  return mapping.get(label) ?? label;
}

/** Simple string hash producing a 32-bit integer seed. */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  // Avoid zero seed which breaks xorshift
  return hash === 0 ? 1 : hash;
}

/** Xorshift32 PRNG — fast, deterministic, good enough for shuffling. */
function xorshift32(state: number): number {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}
