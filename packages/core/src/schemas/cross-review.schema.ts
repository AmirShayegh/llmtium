import type { JsonSchema } from "../providers/types.js";

export const CROSS_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          response_id: { type: "string" },
          correctness: { type: "number" },
          completeness: { type: "number" },
          actionability: { type: "number" },
          clarity: { type: "number" },
        },
        required: ["response_id", "correctness", "completeness", "actionability", "clarity"],
        additionalProperties: false,
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
            additionalProperties: false,
          },
          b: {
            type: "object",
            properties: {
              response_id: { type: "string" },
              quote: { type: "string" },
            },
            required: ["response_id", "quote"],
            additionalProperties: false,
          },
          assessment: { type: "string" },
          suggested_resolution: { type: "string" },
        },
        required: ["topic", "a", "b", "assessment", "suggested_resolution"],
        additionalProperties: false,
      },
    },
    missing_info: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    confidence_reason: { type: "string" },
    notes: { type: "string" },
  },
  required: ["scores", "issues", "disagreements", "missing_info", "confidence", "confidence_reason", "notes"],
  additionalProperties: false,
};
