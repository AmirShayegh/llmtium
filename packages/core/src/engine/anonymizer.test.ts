import { describe, it, expect } from "vitest";
import { anonymize, shuffleForReviewer, deanonymize } from "./anonymizer.js";
import type { AnonymizedResponse } from "../types/index.js";

const threeModels = new Map([
  ["anthropic/claude-sonnet-4.5", "Anthropic draft content"],
  ["openai/gpt-5.2", "OpenAI draft content"],
  ["google/gemini-2.5-flash", "Google draft content"],
]);

describe("anonymizer", () => {
  describe("anonymize", () => {
    it("should assign unique labels matching Response [A-Z] pattern", () => {
      const { anonymized } = anonymize(threeModels);

      expect(anonymized).toHaveLength(3);
      const labels = anonymized.map((r) => r.label);
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(3);
      for (const label of labels) {
        expect(label).toMatch(/^Response [A-Z]$/);
      }
    });

    it("should produce a mapping that round-trips back to original model IDs", () => {
      const { anonymized, mapping } = anonymize(threeModels);

      for (const { label } of anonymized) {
        const modelId = mapping.get(label);
        expect(modelId).toBeDefined();
        expect(threeModels.has(modelId!)).toBe(true);
      }
    });

    it("should cover every input model ID exactly once in the mapping", () => {
      const { mapping } = anonymize(threeModels);

      const modelIds = [...mapping.values()];
      expect(modelIds).toHaveLength(3);
      for (const [modelId] of threeModels) {
        expect(modelIds).toContain(modelId);
      }
    });

    it("should randomize label assignment across iterations", () => {
      const orderings = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const { anonymized } = anonymize(threeModels);
        orderings.add(anonymized.map((r) => r.label).join(","));
      }
      // With 3 models and random shuffling, we expect more than 1 unique ordering
      expect(orderings.size).toBeGreaterThan(1);
    });

    it("should handle a single response", () => {
      const single = new Map([["model-a", "Content A"]]);
      const { anonymized, mapping } = anonymize(single);

      expect(anonymized).toHaveLength(1);
      expect(anonymized[0]!.label).toBe("Response A");
      expect(anonymized[0]!.content).toBe("Content A");
      expect(mapping.size).toBe(1);
      expect(mapping.get("Response A")).toBe("model-a");
    });

    it("should handle two responses", () => {
      const two = new Map([
        ["model-a", "Content A"],
        ["model-b", "Content B"],
      ]);
      const { anonymized, mapping } = anonymize(two);

      expect(anonymized).toHaveLength(2);
      expect(mapping.size).toBe(2);
      const labels = anonymized.map((r) => r.label);
      expect(new Set(labels).size).toBe(2);
    });

    it("should handle empty input", () => {
      const empty = new Map<string, string>();
      const { anonymized, mapping } = anonymize(empty);

      expect(anonymized).toHaveLength(0);
      expect(mapping.size).toBe(0);
    });
  });

  describe("shuffleForReviewer", () => {
    const responses: AnonymizedResponse[] = [
      { label: "Response A", content: "A content" },
      { label: "Response B", content: "B content" },
      { label: "Response C", content: "C content" },
    ];

    it("should return the same number of items", () => {
      const shuffled = shuffleForReviewer(responses, "reviewer-1");
      expect(shuffled).toHaveLength(responses.length);
    });

    it("should preserve all items as a true permutation", () => {
      const shuffled = shuffleForReviewer(responses, "reviewer-1");
      const sortedInput = [...responses].sort((a, b) => a.label.localeCompare(b.label));
      const sortedOutput = [...shuffled].sort((a, b) => a.label.localeCompare(b.label));
      expect(sortedOutput.map((r) => r.label)).toEqual(sortedInput.map((r) => r.label));
      expect(sortedOutput.map((r) => r.content)).toEqual(sortedInput.map((r) => r.content));
    });

    it("should be deterministic for the same reviewer ID", () => {
      const first = shuffleForReviewer(responses, "reviewer-1");
      const second = shuffleForReviewer(responses, "reviewer-1");
      expect(first.map((r) => r.label)).toEqual(second.map((r) => r.label));
    });

    it("should produce different orderings for different reviewer IDs", () => {
      const orderings = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const shuffled = shuffleForReviewer(responses, `reviewer-${i}`);
        orderings.add(shuffled.map((r) => r.label).join(","));
      }
      expect(orderings.size).toBeGreaterThan(1);
    });

    it("should not mutate the original array", () => {
      const original = [...responses];
      shuffleForReviewer(responses, "reviewer-1");
      expect(responses).toEqual(original);
    });

    it("should return a single-item array unchanged", () => {
      const single: AnonymizedResponse[] = [{ label: "Response A", content: "Solo" }];
      const shuffled = shuffleForReviewer(single, "any-reviewer");
      expect(shuffled).toEqual(single);
    });
  });

  describe("deanonymize", () => {
    const mapping = new Map([
      ["Response A", "anthropic/claude-sonnet-4.5"],
      ["Response B", "openai/gpt-5.2"],
    ]);

    it("should return the original model ID for a known label", () => {
      expect(deanonymize("Response A", mapping)).toBe("anthropic/claude-sonnet-4.5");
      expect(deanonymize("Response B", mapping)).toBe("openai/gpt-5.2");
    });

    it("should return the label itself for an unknown label", () => {
      expect(deanonymize("Response Z", mapping)).toBe("Response Z");
    });
  });

  describe("edge cases", () => {
    it("should handle exactly 26 responses", () => {
      const max = new Map<string, string>();
      for (let i = 0; i < 26; i++) {
        max.set(`model-${i}`, `Content ${i}`);
      }
      const { anonymized, mapping } = anonymize(max);
      expect(anonymized).toHaveLength(26);
      expect(mapping.size).toBe(26);
      const labels = new Set(anonymized.map((r) => r.label));
      expect(labels.size).toBe(26);
    });

    it("should throw when given more than 26 responses", () => {
      const tooMany = new Map<string, string>();
      for (let i = 0; i < 27; i++) {
        tooMany.set(`model-${i}`, `Content ${i}`);
      }
      expect(() => anonymize(tooMany)).toThrow("Cannot anonymize more than 26 responses");
    });
  });
});
