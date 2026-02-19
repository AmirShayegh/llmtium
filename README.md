# LLMtium

Multi-LLM deliberation, cross-referencing, and synthesis. Send your prompt to Claude, GPT, and Gemini in parallel -- they independently respond, cross-review each other's work with structured rubric-based evaluation, and a synthesizer merges the best elements into a final output. Not a chat UI. The deliberation pipeline is the product.

**BYOK (Bring Your Own Keys) -- Self-hostable -- Open Source (MIT)**

> LLMtium is in early development (v0.1.0). The core pipeline works. Rough edges exist.

---

## Quick Start

### Web UI

```bash
git clone https://github.com/AmirShayegh/llmtium.git
cd llmtium
pnpm install
pnpm build
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Go to Settings, add API keys for at least 2 of: Anthropic, OpenAI, Google. Then run a consortium.

### MCP Server (Claude Code / Cursor)

Build the MCP package, then copy the config template:

```bash
pnpm --filter llmtium-mcp build
cp .mcp.json.example .mcp.json
```

Edit `.mcp.json` and add your API keys (at least 2 of 3 required). This file is gitignored -- your keys will never be committed.

> **Note:** Restart Claude Code after editing `.mcp.json` for the MCP server to pick up the new keys.

**Available tools:**

| Tool | Description |
|---|---|
| `consortium.review_plan` | Send a plan for multi-LLM review, cross-reference, and synthesis |
| `consortium.deliberate` | Send a prompt for multi-LLM analysis, cross-review, and synthesis |

Both tools accept optional `models` (array of provider IDs) and `synthesizer` (provider ID, default: anthropic) parameters.

**Troubleshooting:**

- **"Need at least 2 providers with API keys configured"** -- Add valid API keys for at least 2 of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` in your `.mcp.json` env block.
- **Tool not found** -- Run `pnpm --filter llmtium-mcp build` and restart Claude Code.

---

## How It Works

```
+---------------------------------------------+
|  Stage 1: PARALLEL DRAFT                    |
|                                             |
|  Claude ---+                                |
|  GPT ------+--- independent responses       |
|  Gemini ---+                                |
+---------------------+-----------------------+
                      |
                      v
+---------------------------------------------+
|  Stage 2: CROSS-REVIEW                      |
|                                             |
|  Each model reviews all other responses     |
|  (anonymized, shuffled order).              |
|  Returns: scores, issues, disagreements,    |
|  missing info, confidence.                  |
+---------------------+-----------------------+
                      |
                      v
+---------------------------------------------+
|  Stage 3: SYNTHESIS                         |
|                                             |
|  Synthesizer merges best elements,          |
|  resolves disagreements with rationale,     |
|  surfaces open questions and action items.  |
+---------------------------------------------+
```

**Why anonymized cross-review?** Identity bias significantly affects LLM evaluations. Randomizing labels and shuffling presentation order per reviewer nearly eliminates this.

**Why 3 models?** Research shows 3-7 agents is optimal for multi-agent deliberation, with diminishing returns beyond 7. Most gains come from the first 3 independent perspectives.

---

## BYOK: Your Keys, Your Machine

LLMtium never stores your API keys on any server. In the web UI, keys are encrypted in your browser's localStorage and sent per-request to the API route, which calls the LLM provider and immediately discards the key. Self-host for keys that never leave your machine.

See [SECURITY.md](SECURITY.md) for the full security model.

---

## Architecture

Monorepo with three packages sharing a core engine:

```
packages/
  core/       @llmtium/core    Deliberation engine, provider adapters, schemas
  web/        llmtium          Next.js 16 web UI (App Router, Tailwind, shadcn/ui)
  mcp/        llmtium-mcp      stdio MCP server for Claude Code / Cursor
```

**Tech:** Next.js 16, React, Tailwind CSS, shadcn/ui, Zustand, raw provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`), `@modelcontextprotocol/sdk`, pnpm workspaces, Turborepo, Vitest.

---

## Self-Hosting

```bash
git clone https://github.com/AmirShayegh/llmtium.git
cd llmtium
pnpm install
pnpm build
pnpm dev               # http://localhost:3000
```

Add your API keys in the web UI (Settings page). For MCP server setup, see [MCP Server](#mcp-server-claude-code--cursor) above.

When self-hosted, your API keys never leave your machine. The browser talks to localhost, which calls LLM APIs directly.

---

## Contributing

1. Fork the repo and create a feature branch
2. `pnpm install`
3. `pnpm test` (runs the full suite)
4. `pnpm build`
5. Submit a PR

Code style: TypeScript strict mode, no `any`, conventional commits (`feat:`, `fix:`, `test:`, `docs:`).

---

## License

[MIT](LICENSE)
