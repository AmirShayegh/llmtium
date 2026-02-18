import { describe, it, expect } from "vitest";
import { validateRunRequest } from "./validate.js";

function validRequest() {
  return {
    prompt: "Review my plan",
    models: ["anthropic", "openai"],
    synthesizer: "anthropic",
    apiKeys: { anthropic: "sk-ant-123", openai: "sk-oai-456" },
  };
}

describe("validateRunRequest", () => {
  it("should return null for a valid request", () => {
    expect(validateRunRequest(validRequest())).toBeNull();
  });

  it("should return null when context is provided", () => {
    const req = { ...validRequest(), context: "Extra context" };
    expect(validateRunRequest(req)).toBeNull();
  });

  it("should return error for missing prompt", () => {
    const req = { ...validRequest(), prompt: undefined };
    expect(validateRunRequest(req)).toContain("prompt");
  });

  it("should return error for empty prompt", () => {
    const req = { ...validRequest(), prompt: "   " };
    expect(validateRunRequest(req)).toContain("prompt");
  });

  it("should return error for non-object body", () => {
    expect(validateRunRequest(null)).toContain("object");
    expect(validateRunRequest("string")).toContain("object");
  });

  it("should return error when models has fewer than 2 entries", () => {
    const req = { ...validRequest(), models: ["anthropic"] };
    expect(validateRunRequest(req)).toContain("2");
  });

  it("should return error for unknown provider in models", () => {
    const req = { ...validRequest(), models: ["anthropic", "unknown"] };
    expect(validateRunRequest(req)).toContain("unknown");
  });

  it("should return error for duplicate providers", () => {
    const req = {
      ...validRequest(),
      models: ["anthropic", "anthropic"],
      apiKeys: { anthropic: "sk-123" },
    };
    expect(validateRunRequest(req)).toContain("Duplicate");
  });

  it("should return error for missing apiKey for a model", () => {
    const req = { ...validRequest(), apiKeys: { anthropic: "sk-123" } };
    expect(validateRunRequest(req)).toContain("apiKey");
  });

  it("should return error for empty apiKey", () => {
    const req = { ...validRequest(), apiKeys: { anthropic: "sk-123", openai: "" } };
    expect(validateRunRequest(req)).toContain("apiKey");
  });

  it("should return error for missing synthesizer", () => {
    const req = { ...validRequest(), synthesizer: undefined };
    expect(validateRunRequest(req)).toContain("synthesizer");
  });

  it("should return error for unknown synthesizer provider", () => {
    const req = { ...validRequest(), synthesizer: "unknown" };
    expect(validateRunRequest(req)).toContain("unknown");
  });

  it("should return error when synthesizer has no apiKey", () => {
    const req = {
      prompt: "Test",
      models: ["anthropic", "openai"],
      synthesizer: "google",
      apiKeys: { anthropic: "sk-123", openai: "sk-456" },
    };
    expect(validateRunRequest(req)).toContain("apiKey");
  });
});
