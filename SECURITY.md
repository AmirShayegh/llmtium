# Security

LLMtium is designed so your API keys and data never leave your control.

## API Key Handling

### Web UI (self-hosted or llmtium.com)

- **Client-side encryption:** API keys are encrypted using AES-GCM via the Web Crypto API before being stored in your browser's localStorage.
- **Ephemeral server proxy:** When you run a consortium, your keys are sent from the browser to the Next.js API route, used for that single request to call LLM provider APIs, then immediately discarded. Keys are never stored, logged, or persisted on the server.
- **No server-side key storage:** The server is stateless with respect to your keys. Each request is independent.

### MCP Server (local CLI)

- Keys are read from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`).
- The MCP server runs locally on your machine as a stdio process.
- Keys never transit any remote server.

## Self-Hosting

For maximum security, self-host LLMtium:

```bash
git clone https://github.com/AmirShayegh/llmtium.git
cd llmtium
pnpm install && pnpm build && pnpm dev
```

When self-hosted, your API keys never leave your machine. The browser sends keys to localhost, which calls LLM APIs directly. No third-party server is involved.

## What We Do NOT Do

- **No analytics.** Zero tracking scripts, no Google Analytics, no Vercel Analytics, nothing.
- **No telemetry.** The application does not phone home. No usage data is collected or transmitted.
- **No data collection.** Your prompts, responses, reviews, and synthesis results exist only in your browser's localStorage and are never sent anywhere except to the LLM providers you configure.
- **No cookies.** No session cookies, no tracking cookies, no third-party cookies.

## Threat Model

**Protected:**

- Server-side key leakage -- keys are ephemeral, never persisted server-side
- Cross-user data exposure -- no user accounts, no shared state
- Analytics/tracking -- none exists

**Not protected (inherent to the architecture):**

- Browser-level attacks -- if your browser is compromised, localStorage is accessible. AES-GCM encryption raises the bar but is not a substitute for browser security.
- Network interception -- keys transit HTTPS from browser to server. Self-hosting on localhost eliminates this.
- LLM provider data policies -- your prompts are sent to Anthropic, OpenAI, and/or Google APIs. Their data handling policies apply.
- localStorage persistence -- encrypted keys persist until you clear them. Physical access to your machine and browser could expose them.

## Reporting Vulnerabilities

If you discover a security vulnerability, please open a private security advisory on GitHub. Do not open public issues for security vulnerabilities.
