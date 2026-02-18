import type { JsonSchema } from "../providers/types.js";

export const CROSS_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          correctness: { type: "number", minimum: 1, maximum: 5 },
          completeness: { type: "number", minimum: 1, maximum: 5 },
          actionability: { type: "number", minimum: 1, maximum: 5 },
          clarity: { type: "number", minimum: 1, maximum: 5 },
        },
        required: ["correctness", "completeness", "actionability", "clarity"],
      },
    },
    issues: { type: "array", items: { type: "string" } },
    disagreements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          a: {
            type: "object",
            properties: {
              response_id: { type: "string" },
              quote: { type: "string" },
            },
            required: ["response_id", "quote"],
          },
          b: {
            type: "object",
            properties: {
              response_id: { type: "string" },
              quote: { type: "string" },
            },
            required: ["response_id", "quote"],
          },
          assessment: { type: "string" },
          suggested_resolution: { type: "string" },
        },
        required: ["topic", "a", "b", "assessment"],
      },
    },
    missing_info: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    confidence_reason: { type: "string" },
    notes: { type: ["string", "null"] },
  },
  required: ["scores", "issues", "disagreements", "missing_info", "confidence", "confidence_reason"],
};
