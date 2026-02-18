// Keys are ephemeral — used for this request only, never stored or logged

import { reviewPlan } from "@llmtium/core";
import type { PipelineEvent } from "@llmtium/core";
import { toProviderWithConfig } from "@/lib/providers";
import { serializeWorkflowResult } from "@/lib/serialize";
import { validateRunRequest } from "./validate";

export const runtime = "nodejs";

interface RunRequest {
  prompt: string;
  context?: string;
  models: string[];
  synthesizer: string;
  apiKeys: Record<string, string>;
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as unknown;

  const validationError = validateRunRequest(body);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  const req = body as RunRequest;

  const providers = req.models.map((id) =>
    toProviderWithConfig(id, req.apiKeys[id]!),
  );
  const synthesizer = toProviderWithConfig(
    req.synthesizer,
    req.apiKeys[req.synthesizer]!,
  );

  const encoder = new TextEncoder();
  let closed = false;

  request.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: PipelineEvent | Record<string, unknown>): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      }

      try {
        const result = await reviewPlan({
          plan: req.prompt,
          context: req.context,
          providers,
          synthesizer,
          onProgress: sendEvent,
        });

        const serialized = serializeWorkflowResult(result);
        sendEvent({ stage: "done", status: "complete", result: serialized });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        sendEvent({ stage: "done", status: "error", error: msg });
      } finally {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
