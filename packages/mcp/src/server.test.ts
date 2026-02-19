import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("@llmtium/core", () => ({
  reviewPlan: vi.fn(),
  anthropicProvider: {
    meta: { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-20250514" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  openaiProvider: {
    meta: { id: "openai", name: "OpenAI", defaultModel: "gpt-4o" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  googleProvider: {
    meta: { id: "google", name: "Google", defaultModel: "gemini-2.0-flash" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
}));

const registerToolSpy = vi.spyOn(McpServer.prototype, "registerTool");

beforeEach(() => {
  registerToolSpy.mockClear();
});

describe("createServer", () => {
  it("should register the consortium.review_plan tool", async () => {
    const { createServer } = await import("./server.js");
    createServer();

    expect(registerToolSpy).toHaveBeenCalledWith(
      "consortium.review_plan",
      expect.objectContaining({
        description: expect.any(String),
      }),
      expect.any(Function),
    );
  });

  it("should return an McpServer instance", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();

    expect(server).toBeInstanceOf(McpServer);
  });

  it("should define plan as required and context/models/synthesizer as optional in input schema", async () => {
    const { createServer } = await import("./server.js");
    createServer();

    const call = registerToolSpy.mock.calls.find((c) => c[0] === "consortium.review_plan");
    expect(call).toBeDefined();

    const config = call![1] as Record<string, unknown>;
    const schema = config.inputSchema as Record<string, { isOptional: () => boolean }>;

    // plan must be required
    expect(schema.plan.isOptional()).toBe(false);
    // context, models, synthesizer must be optional
    expect(schema.context.isOptional()).toBe(true);
    expect(schema.models.isOptional()).toBe(true);
    expect(schema.synthesizer.isOptional()).toBe(true);
  });
});
