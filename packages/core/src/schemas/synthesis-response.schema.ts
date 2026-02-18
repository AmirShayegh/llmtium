import type { JsonSchema } from "../providers/types.js";

export const SYNTHESIS_RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    output: { type: "string" },
    resolved_disagreements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          chosen_position: { type: "string" },
          rationale: { type: "string" },
          supporting_responses: { type: "array", items: { type: "string" } },
        },
        required: ["topic", "chosen_position", "rationale", "supporting_responses"],
      },
    },
    open_questions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["P0", "P1", "P2"] },
          item: { type: "string" },
        },
        required: ["priority", "item"],
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    confidence_reason: { type: "string" },
  },
  required: ["output", "resolved_disagreements", "open_questions", "action_items", "confidence", "confidence_reason"],
};
