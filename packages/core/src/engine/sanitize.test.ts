import { describe, it, expect } from "vitest";
import { sanitizeReview, sanitizeSynthesis } from "./sanitize.js";
import type { CrossReview } from "../types/cross-review.js";
import type { SynthesisResponse } from "../types/synthesis-response.js";

function makeReview(overrides?: Partial<CrossReview>): CrossReview {
  return {
    scores: [
      { response_id: "A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 },
    ],
    issues: [],
    disagreements: [],
    missing_info: [],
    confidence: 0.8,
    confidence_reason: "test",
    notes: "",
    ...overrides,
  };
}

function makeSynthesis(overrides?: Partial<SynthesisResponse>): SynthesisResponse {
  return {
    output: "Synthesized",
    resolved_disagreements: [],
    open_questions: [],
    action_items: [],
    confidence: 0.9,
    confidence_reason: "test",
    ...overrides,
  };
}

describe("sanitizeReview", () => {
  it("should return the same object when all values are in range", () => {
    const review = makeReview();
    const result = sanitizeReview(review);
    expect(result).toBe(review);
  });

  it("should clamp scores above 5 to 5", () => {
    const review = makeReview({
      scores: [{ response_id: "A", correctness: 8, completeness: 3, actionability: 5, clarity: 4 }],
    });
    const result = sanitizeReview(review);
    expect(result.scores[0]!.correctness).toBe(5);
    expect(result.scores[0]!.completeness).toBe(3);
  });

  it("should clamp scores below 1 to 1", () => {
    const review = makeReview({
      scores: [{ response_id: "A", correctness: -2, completeness: 0, actionability: 1, clarity: 4 }],
    });
    const result = sanitizeReview(review);
    expect(result.scores[0]!.correctness).toBe(1);
    expect(result.scores[0]!.completeness).toBe(1);
    expect(result.scores[0]!.actionability).toBe(1);
  });

  it("should clamp confidence above 1 to 1", () => {
    const review = makeReview({ confidence: 1.5 });
    const result = sanitizeReview(review);
    expect(result.confidence).toBe(1);
  });

  it("should clamp confidence below 0 to 0", () => {
    const review = makeReview({ confidence: -0.3 });
    const result = sanitizeReview(review);
    expect(result.confidence).toBe(0);
  });

  it("should clamp multiple out-of-range fields at once", () => {
    const review = makeReview({
      scores: [
        { response_id: "A", correctness: 10, completeness: -1, actionability: 5, clarity: 0 },
        { response_id: "B", correctness: 3, completeness: 3, actionability: 3, clarity: 3 },
      ],
      confidence: 2.0,
    });
    const result = sanitizeReview(review);
    expect(result.scores[0]!.correctness).toBe(5);
    expect(result.scores[0]!.completeness).toBe(1);
    expect(result.scores[0]!.clarity).toBe(1);
    expect(result.scores[1]!.correctness).toBe(3);
    expect(result.confidence).toBe(1);
  });

  it("should preserve all non-numeric fields unchanged", () => {
    const review = makeReview({
      scores: [{ response_id: "A", correctness: 99, completeness: 3, actionability: 5, clarity: 4 }],
      issues: ["test issue"],
      notes: "some notes",
    });
    const result = sanitizeReview(review);
    expect(result.issues).toEqual(["test issue"]);
    expect(result.notes).toBe("some notes");
    expect(result.scores[0]!.response_id).toBe("A");
  });

  it("should default malformed scores to empty array", () => {
    const malformed = makeReview({ issues: ["has content"] }) as unknown as CrossReview;
    (malformed as Record<string, unknown>).scores = "not-an-array";
    const result = sanitizeReview(malformed);
    expect(result.scores).toEqual([]);
  });

  it("should default missing array fields to empty arrays", () => {
    const malformed = makeReview() as unknown as CrossReview;
    (malformed as Record<string, unknown>).issues = undefined;
    (malformed as Record<string, unknown>).disagreements = null;
    (malformed as Record<string, unknown>).missing_info = 42;
    const result = sanitizeReview(malformed);
    expect(result.issues).toEqual([]);
    expect(result.disagreements).toEqual([]);
    expect(result.missing_info).toEqual([]);
  });

  it("should filter out scores with empty response_id", () => {
    const review = makeReview({
      scores: [
        { response_id: "", correctness: 4, completeness: 3, actionability: 5, clarity: 4 },
        { response_id: "A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 },
      ],
    });
    const result = sanitizeReview(review);
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]!.response_id).toBe("A");
  });

  it("should filter out disagreements with empty topic", () => {
    const review = makeReview({
      disagreements: [
        { topic: "", a: { response_id: "A", quote: "x" }, b: { response_id: "B", quote: "y" }, assessment: "ok", suggested_resolution: "" },
        { topic: "Real topic", a: { response_id: "A", quote: "x" }, b: { response_id: "B", quote: "y" }, assessment: "ok", suggested_resolution: "" },
      ],
    });
    const result = sanitizeReview(review);
    expect(result.disagreements).toHaveLength(1);
    expect(result.disagreements[0]!.topic).toBe("Real topic");
  });

  it("should default disagreement a/b to empty when non-object", () => {
    const review = makeReview({
      disagreements: [
        {
          topic: "T",
          a: null as unknown as { response_id: string; quote: string },
          b: "bad" as unknown as { response_id: string; quote: string },
          assessment: "ok",
          suggested_resolution: "",
        },
      ],
    });
    const result = sanitizeReview(review);
    expect(result.disagreements[0]!.a).toEqual({ response_id: "", quote: "" });
    expect(result.disagreements[0]!.b).toEqual({ response_id: "", quote: "" });
  });

  it("should filter out null/non-object elements from scores array", () => {
    const review = makeReview({
      scores: [null, { response_id: "A", correctness: 4, completeness: 3, actionability: 5, clarity: 4 }, "bad"] as unknown as CrossReview["scores"],
    });
    const result = sanitizeReview(review);
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]!.response_id).toBe("A");
  });

  it("should coerce non-numeric score values to fallback", () => {
    const review = makeReview({
      scores: [{ response_id: "A", correctness: "bad" as unknown as number, completeness: 3, actionability: 5, clarity: 4 }],
    });
    const result = sanitizeReview(review);
    expect(result.scores[0]!.correctness).toBe(3); // fallback
  });

  it("should coerce non-numeric confidence to fallback", () => {
    const review = makeReview({ confidence: "high" as unknown as number });
    const result = sanitizeReview(review);
    expect(result.confidence).toBe(0.5); // fallback
  });

  it("should throw on vacuous review (no scores, no issues, no disagreements)", () => {
    const review = makeReview({ scores: [], issues: [], disagreements: [] });
    expect(() => sanitizeReview(review)).toThrow("vacuous");
  });

  it("should throw on vacuous review even with confidence_reason present", () => {
    const review = makeReview({ scores: [], issues: [], disagreements: [], confidence_reason: "boilerplate" });
    expect(() => sanitizeReview(review)).toThrow("vacuous");
  });

  it("should not throw when scores are empty but issues are present", () => {
    const review = makeReview({ scores: [], issues: ["real issue"], disagreements: [] });
    expect(() => sanitizeReview(review)).not.toThrow();
  });

  it("should not throw when scores are empty but disagreements are present", () => {
    const review = makeReview({
      scores: [],
      issues: [],
      disagreements: [
        { topic: "T", a: { response_id: "A", quote: "x" }, b: { response_id: "B", quote: "y" }, assessment: "ok", suggested_resolution: "" },
      ],
    });
    expect(() => sanitizeReview(review)).not.toThrow();
  });

  it("should not throw when only missing_info is present", () => {
    const review = makeReview({ scores: [], issues: [], disagreements: [], missing_info: ["No backup plan"] });
    expect(() => sanitizeReview(review)).not.toThrow();
  });
});

describe("sanitizeSynthesis", () => {
  it("should return the same object when confidence is in range", () => {
    const synthesis = makeSynthesis();
    const result = sanitizeSynthesis(synthesis);
    expect(result).toBe(synthesis);
  });

  it("should clamp confidence above 1 to 1", () => {
    const synthesis = makeSynthesis({ confidence: 1.5 });
    const result = sanitizeSynthesis(synthesis);
    expect(result.confidence).toBe(1);
  });

  it("should clamp confidence below 0 to 0", () => {
    const synthesis = makeSynthesis({ confidence: -0.1 });
    const result = sanitizeSynthesis(synthesis);
    expect(result.confidence).toBe(0);
  });

  it("should preserve all other fields unchanged", () => {
    const synthesis = makeSynthesis({
      output: "Important output",
      confidence: 5.0,
      confidence_reason: "very confident",
    });
    const result = sanitizeSynthesis(synthesis);
    expect(result.output).toBe("Important output");
    expect(result.confidence_reason).toBe("very confident");
    expect(result.confidence).toBe(1);
  });

  it("should coerce non-numeric confidence to fallback", () => {
    const synthesis = makeSynthesis({ confidence: undefined as unknown as number });
    const result = sanitizeSynthesis(synthesis);
    expect(result.confidence).toBe(0.5); // fallback
  });

  it("should default missing array fields to empty arrays", () => {
    const malformed = makeSynthesis() as unknown as SynthesisResponse;
    (malformed as Record<string, unknown>).resolved_disagreements = undefined;
    (malformed as Record<string, unknown>).open_questions = "not-array";
    (malformed as Record<string, unknown>).action_items = null;
    const result = sanitizeSynthesis(malformed);
    expect(result.resolved_disagreements).toEqual([]);
    expect(result.open_questions).toEqual([]);
    expect(result.action_items).toEqual([]);
  });

  it("should throw on missing output", () => {
    const synthesis = makeSynthesis({ output: null as unknown as string });
    expect(() => sanitizeSynthesis(synthesis)).toThrow();
  });

  it("should throw on empty output", () => {
    const synthesis = makeSynthesis({ output: "" });
    expect(() => sanitizeSynthesis(synthesis)).toThrow();
  });

  it("should filter out action items with empty item text", () => {
    const synthesis = makeSynthesis({
      action_items: [
        { priority: "P0", item: "" },
        { priority: "P1", item: "Real task" },
      ],
    });
    const result = sanitizeSynthesis(synthesis);
    expect(result.action_items).toHaveLength(1);
    expect(result.action_items[0]!.item).toBe("Real task");
  });

  it("should coerce invalid priority to P2", () => {
    const synthesis = makeSynthesis({
      action_items: [{ priority: "URGENT" as "P0", item: "Do it" }],
    });
    const result = sanitizeSynthesis(synthesis);
    expect(result.action_items[0]!.priority).toBe("P2");
  });

  it("should filter out null/non-object elements from nested arrays", () => {
    const synthesis = makeSynthesis({
      resolved_disagreements: [null, { topic: "T", chosen_position: "P", rationale: "R", supporting_responses: ["A"] }] as unknown as SynthesisResponse["resolved_disagreements"],
      action_items: [null, { priority: "P0", item: "Do it" }, 42] as unknown as SynthesisResponse["action_items"],
    });
    const result = sanitizeSynthesis(synthesis);
    expect(result.resolved_disagreements).toHaveLength(1);
    expect(result.resolved_disagreements[0]!.topic).toBe("T");
    expect(result.action_items).toHaveLength(1);
    expect(result.action_items[0]!.item).toBe("Do it");
  });
});
