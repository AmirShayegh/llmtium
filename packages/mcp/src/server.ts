import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { handleReviewPlan } from "./tools/review-plan.js";
import { handleDeliberate } from "./tools/deliberate.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const VALID_PROVIDERS = ["anthropic", "openai", "google"] as const;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "llmtium-mcp",
    version: pkg.version,
    description: "Multi-LLM deliberation and cross-review",
  });

  server.registerTool("consortium.review_plan", {
    description:
      "Send a plan to multiple LLMs for independent review, cross-reference, and synthesis. " +
      "Returns a synthesized assessment with resolved disagreements and action items.",
    inputSchema: {
      plan: z.string().describe("The plan or proposal to review"),
      context: z.string().optional().describe("Additional context about the plan"),
      models: z
        .array(z.enum(VALID_PROVIDERS))
        .optional()
        .describe("Provider IDs to use. Defaults to all providers with API keys set."),
      synthesizer: z
        .enum(VALID_PROVIDERS)
        .optional()
        .describe("Provider ID for synthesis (default: anthropic)"),
    },
  }, async (input) => handleReviewPlan(input));

  server.registerTool("consortium.deliberate", {
    description:
      "Send a prompt to multiple LLMs for independent analysis, cross-review, and synthesis. " +
      "Returns a synthesized response with resolved disagreements and action items.",
    inputSchema: {
      prompt: z.string().describe("The prompt for deliberation"),
      context: z.string().optional().describe("Additional context"),
      models: z
        .array(z.enum(VALID_PROVIDERS))
        .optional()
        .describe("Provider IDs to use. Defaults to all providers with API keys set."),
      synthesizer: z
        .enum(VALID_PROVIDERS)
        .optional()
        .describe("Provider ID for synthesis (default: anthropic)"),
    },
  }, async (input) => handleDeliberate(input));

  return server;
}
