import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@llmtium/core", () => ({
  anthropicProvider: {
    meta: { id: "anthropic", name: "Anthropic", defaultModel: "claude-model" },
    validateKey: vi.fn(),
  },
  openaiProvider: {
    meta: { id: "openai", name: "OpenAI", defaultModel: "gpt-model" },
    validateKey: vi.fn(),
  },
  googleProvider: {
    meta: { id: "google", name: "Google", defaultModel: "gemini-model" },
    validateKey: vi.fn(),
  },
}));

import { anthropicProvider } from "@llmtium/core";
import { POST } from "./route.js";

const mockValidateKey = anthropicProvider.validateKey as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/keys/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/keys/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return valid: true for a valid key", async () => {
    mockValidateKey.mockResolvedValue({ success: true, data: true });

    const response = await POST(makeRequest({ provider: "anthropic", apiKey: "sk-valid" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: true });
    expect(mockValidateKey).toHaveBeenCalledWith({ apiKey: "sk-valid" });
  });

  it("should return valid: false with error for invalid key", async () => {
    mockValidateKey.mockResolvedValue({ success: false, error: "Invalid API key" });

    const response = await POST(makeRequest({ provider: "anthropic", apiKey: "sk-bad" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("should return 400 for unknown provider", async () => {
    const response = await POST(makeRequest({ provider: "unknown", apiKey: "sk-123" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Unknown provider");
  });

  it("should return 400 for missing apiKey", async () => {
    const response = await POST(makeRequest({ provider: "anthropic" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("apiKey");
  });

  it("should return 400 for missing provider", async () => {
    const response = await POST(makeRequest({ apiKey: "sk-123" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("provider");
  });

  it("should return 400 for malformed JSON body", async () => {
    const request = new Request("http://localhost/api/keys/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });
});
