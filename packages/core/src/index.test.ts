import { describe, it, expect } from "vitest";
import {
  anthropicProvider,
  openaiProvider,
  googleProvider,
  anonymize,
  shuffleForReviewer,
  deanonymize,
} from "./index.js";
import type {
  CrossReview,
  SynthesisResponse,
  AnonymizedResponse,
} from "./index.js";

describe("@llmtium/core", () => {
  describe("CrossReview schema", () => {
    it("should enforce the correct shape with all required fields", () => {
      const review: CrossReview = {
        scores: {
          "Response A": {
            correctness: 4,
            completeness: 3,
            actionability: 5,
            clarity: 4,
          },
        },
        issues: ["Missing error handling for edge case"],
        disagreements: [
          {
            topic: "Database choice",
            a: { response_id: "Response A", quote: "Use PostgreSQL" },
            b: { response_id: "Response B", quote: "Use SQLite" },
            assessment: "PostgreSQL is more appropriate at scale",
          },
        ],
        missing_info: ["No mention of backup strategy"],
        confidence: 0.85,
        confidence_reason: "High familiarity with the domain",
      };

      expect(review.scores["Response A"]?.correctness).toBe(4);
      expect(review.issues).toHaveLength(1);
      expect(review.disagreements[0]?.topic).toBe("Database choice");
      expect(review.disagreements[0]?.a.response_id).toBe("Response A");
      expect(review.disagreements[0]?.b.quote).toBe("Use SQLite");
      expect(review.missing_info[0]).toBe("No mention of backup strategy");
      expect(review.confidence).toBe(0.85);
      expect(review.notes).toBeUndefined();
    });

    it("should allow optional fields", () => {
      const review: CrossReview = {
        scores: {},
        issues: [],
        disagreements: [
          {
            topic: "Approach",
            a: { response_id: "A", quote: "x" },
            b: { response_id: "B", quote: "y" },
            assessment: "A is better",
            suggested_resolution: "Use approach A",
          },
        ],
        missing_info: [],
        confidence: 0.5,
        confidence_reason: "Uncertain domain",
        notes: "Additional context needed",
      };

      expect(review.notes).toBe("Additional context needed");
      expect(review.disagreements[0]?.suggested_resolution).toBe("Use approach A");
    });
  });

  describe("SynthesisResponse schema", () => {
    it("should enforce the correct shape with all required fields", () => {
      const synthesis: SynthesisResponse = {
        output: "The synthesized recommendation is...",
        resolved_disagreements: [
          {
            topic: "Database choice",
            chosen_position: "PostgreSQL",
            rationale: "Better scalability characteristics",
            supporting_responses: ["A", "C"],
          },
        ],
        open_questions: ["What is the expected query volume?"],
        action_items: [
          { priority: "P0", item: "Set up database schema" },
          { priority: "P1", item: "Write migration scripts" },
          { priority: "P2", item: "Add monitoring" },
        ],
        confidence: 0.9,
        confidence_reason: "Strong consensus across reviewers",
      };

      expect(synthesis.output).toContain("synthesized recommendation");
      expect(synthesis.resolved_disagreements[0]?.topic).toBe("Database choice");
      expect(synthesis.resolved_disagreements[0]?.supporting_responses).toEqual(["A", "C"]);
      expect(synthesis.open_questions).toHaveLength(1);
      expect(synthesis.action_items).toHaveLength(3);
      expect(synthesis.action_items[0]?.priority).toBe("P0");
      expect(synthesis.action_items[1]?.priority).toBe("P1");
      expect(synthesis.action_items[2]?.priority).toBe("P2");
      expect(synthesis.confidence).toBe(0.9);
    });
  });

  describe("Provider exports", () => {
    it("should export three providers with correct metadata", () => {
      expect(anthropicProvider.meta.id).toBe("anthropic");
      expect(anthropicProvider.meta.name).toBe("Anthropic");
      expect(openaiProvider.meta.id).toBe("openai");
      expect(openaiProvider.meta.name).toBe("OpenAI");
      expect(googleProvider.meta.id).toBe("google");
      expect(googleProvider.meta.name).toBe("Google");
    });
  });

  describe("Anonymizer exports", () => {
    it("should export anonymize, shuffleForReviewer, deanonymize functions and AnonymizedResponse type", () => {
      expect(typeof anonymize).toBe("function");
      expect(typeof shuffleForReviewer).toBe("function");
      expect(typeof deanonymize).toBe("function");

      // Type-level check: AnonymizedResponse compiles
      const response: AnonymizedResponse = { label: "Response A", content: "test" };
      expect(response.label).toBe("Response A");
    });
  });
});
