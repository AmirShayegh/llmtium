import type { CrossReview } from "../types/cross-review.js";
import type { SynthesisResponse } from "../types/synthesis-response.js";

function toNum(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = toNum(value, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function ensureObjArray<T>(value: unknown): { arr: T[]; changed: boolean } {
  if (!Array.isArray(value)) return { arr: [], changed: true };
  const filtered = value.filter(isObj) as T[];
  return filtered.length === value.length
    ? { arr: filtered, changed: false }
    : { arr: filtered, changed: true };
}

function ensureStringArray(value: unknown): { arr: string[]; changed: boolean } {
  if (!Array.isArray(value)) return { arr: [], changed: true };
  const filtered = value.filter((v): v is string => typeof v === "string");
  return filtered.length === value.length
    ? { arr: filtered, changed: false }
    : { arr: filtered, changed: true };
}

function ensureString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function sanitizeReview(review: CrossReview): CrossReview {
  let changed = false;

  const rawScores = ensureObjArray<CrossReview["scores"][number]>(review.scores);
  if (rawScores.changed) changed = true;

  const scores = rawScores.arr
    .map((s) => {
      const correctness = clamp(s.correctness, 1, 5, 3);
      const completeness = clamp(s.completeness, 1, 5, 3);
      const actionability = clamp(s.actionability, 1, 5, 3);
      const clarity = clamp(s.clarity, 1, 5, 3);
      const response_id = ensureString(s.response_id);
      if (
        correctness !== s.correctness ||
        completeness !== s.completeness ||
        actionability !== s.actionability ||
        clarity !== s.clarity ||
        response_id !== s.response_id
      ) {
        changed = true;
        return { ...s, response_id, correctness, completeness, actionability, clarity };
      }
      return s;
    })
    .filter((s) => {
      if (!s.response_id) { changed = true; return false; }
      return true;
    });

  const issuesResult = ensureStringArray(review.issues);
  const issues = issuesResult.arr;
  if (issuesResult.changed) changed = true;

  const disagResult = ensureObjArray<CrossReview["disagreements"][number]>(review.disagreements);
  const disagreements = disagResult.arr
    .map((d) => {
      const topic = ensureString(d.topic);
      const a = isObj(d.a) ? { response_id: ensureString(d.a.response_id), quote: ensureString(d.a.quote) } : { response_id: "", quote: "" };
      const b = isObj(d.b) ? { response_id: ensureString(d.b.response_id), quote: ensureString(d.b.quote) } : { response_id: "", quote: "" };
      const assessment = ensureString(d.assessment);
      const suggested_resolution = ensureString(d.suggested_resolution);
      if (topic !== d.topic || assessment !== d.assessment || suggested_resolution !== d.suggested_resolution ||
          a.response_id !== d.a?.response_id || a.quote !== d.a?.quote ||
          b.response_id !== d.b?.response_id || b.quote !== d.b?.quote) {
        changed = true;
        return { topic, a, b, assessment, suggested_resolution };
      }
      return d;
    })
    .filter((d) => {
      if (!d.topic) { changed = true; return false; }
      return true;
    });
  if (disagResult.changed) changed = true;

  const missingResult = ensureStringArray(review.missing_info);
  const missing_info = missingResult.arr;
  if (missingResult.changed) changed = true;

  const confidence = clamp(review.confidence, 0, 1, 0.5);
  if (confidence !== review.confidence) changed = true;

  const confidence_reason = ensureString(review.confidence_reason);
  if (confidence_reason !== review.confidence_reason) changed = true;

  const notes = ensureString(review.notes);
  if (notes !== review.notes) changed = true;

  // Vacuous review: no actionable content at all → likely garbage
  if (scores.length === 0 && issues.length === 0 && disagreements.length === 0 && missing_info.length === 0) {
    throw new TypeError("review is vacuous: no scores, issues, disagreements, or missing_info");
  }

  if (!changed) return review;
  return { ...review, scores, issues, disagreements, missing_info, confidence, confidence_reason, notes };
}

const VALID_PRIORITIES = new Set<string>(["P0", "P1", "P2"]);

function ensurePriority(value: unknown): "P0" | "P1" | "P2" {
  return typeof value === "string" && VALID_PRIORITIES.has(value)
    ? (value as "P0" | "P1" | "P2")
    : "P2";
}

export function sanitizeSynthesis(synthesis: SynthesisResponse): SynthesisResponse {
  let changed = false;

  const output = ensureString(synthesis.output);
  if (!output) {
    throw new TypeError("synthesis.output is empty or missing");
  }
  if (output !== synthesis.output) changed = true;

  const confidence = clamp(synthesis.confidence, 0, 1, 0.5);
  if (confidence !== synthesis.confidence) changed = true;

  const rdResult = ensureObjArray<SynthesisResponse["resolved_disagreements"][number]>(synthesis.resolved_disagreements);
  const resolved_disagreements = rdResult.arr.map((d) => {
    const topic = ensureString(d.topic);
    const chosen_position = ensureString(d.chosen_position);
    const rationale = ensureString(d.rationale);
    const srResult = ensureStringArray(d.supporting_responses);
    const supporting_responses = srResult.arr;
    if (topic !== d.topic || chosen_position !== d.chosen_position ||
        rationale !== d.rationale || srResult.changed) {
      changed = true;
      return { topic, chosen_position, rationale, supporting_responses };
    }
    return d;
  });
  if (rdResult.changed) changed = true;

  const oqResult = ensureStringArray(synthesis.open_questions);
  const open_questions = oqResult.arr;
  if (oqResult.changed) changed = true;

  const aiResult = ensureObjArray<SynthesisResponse["action_items"][number]>(synthesis.action_items);
  const action_items = aiResult.arr
    .map((item) => {
      const priority = ensurePriority(item.priority);
      const itemText = ensureString(item.item);
      if (priority !== item.priority || itemText !== item.item) {
        changed = true;
        return { priority, item: itemText };
      }
      return item;
    })
    .filter((item) => {
      if (!item.item) { changed = true; return false; }
      return true;
    });
  if (aiResult.changed) changed = true;

  const confidence_reason = ensureString(synthesis.confidence_reason);
  if (confidence_reason !== synthesis.confidence_reason) changed = true;

  if (!changed) return synthesis;
  return { ...synthesis, output, confidence, resolved_disagreements, open_questions, action_items, confidence_reason };
}
