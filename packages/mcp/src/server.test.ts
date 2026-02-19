import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("@llmtium/core", () => ({
  general: vi.fn(),
  reviewPlan: vi.fn(),
  anthropicProvider: {
    meta: { id: "anthropic", name: "Anthropic", defaultModel: "claude-opus-4-6" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  openaiProvider: {
    meta: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.2" },
    draft: vi.fn(),
    structuredOutput: vi.fn(),
    validateKey: vi.fn(),
  },
  googleProvider: {
    meta: { id: "google", name: "Google", defaultModel: "gemini-2.5-flash" },
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

  it("should register the consortium.deliberate tool", async () => {
    const { createServer } = await import("./server.js");
    createServer();

    expect(registerToolSpy).toHaveBeenCalledWith(
      "consortium.deliberate",
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

  it("should define plan as required and context/models/synthesizer as optional in review_plan schema", async () => {
    const { createServer } = await import("./server.js");
    createServer();

    const call = registerToolSpy.mock.calls.find((c) => c[0] === "consortium.review_plan");
    expect(call).toBeDefined();

    const config = call![1] as Record<string, unknown>;
    const schema = config.inputSchema as Record<string, { isOptional: () => boolean }>;

    expect(schema.plan.isOptional()).toBe(false);
    expect(schema.context.isOptional()).toBe(true);
    expect(schema.models.isOptional()).toBe(true);
    expect(schema.synthesizer.isOptional()).toBe(true);
  });

  it("should define prompt as required and context/models/synthesizer as optional in deliberate schema", async () => {
    const { createServer } = await import("./server.js");
    createServer();

    const call = registerToolSpy.mock.calls.find((c) => c[0] === "consortium.deliberate");
    expect(call).toBeDefined();

    const config = call![1] as Record<string, unknown>;
    const schema = config.inputSchema as Record<string, { isOptional: () => boolean }>;

    expect(schema.prompt.isOptional()).toBe(false);
    expect(schema.context.isOptional()).toBe(true);
    expect(schema.models.isOptional()).toBe(true);
    expect(schema.synthesizer.isOptional()).toBe(true);
  });
});
