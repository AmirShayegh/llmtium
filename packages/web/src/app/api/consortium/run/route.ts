// Keys are ephemeral — used for this request only, never stored or logged

import { reviewPlan, general } from "@llmtium/core";
import type { PipelineEvent, WorkflowResult } from "@llmtium/core";
import { toProviderWithConfig } from "@/lib/providers";
import { serializeWorkflowResult } from "@/lib/serialize";
import { validateRunRequest } from "./validate";

export const runtime = "nodejs";

interface RunRequest {
  prompt: string;
  context?: string;
  workflow?: string;
  models: string[];
  synthesizer: string;
  apiKeys: Record<string, string>;
  modelOverrides?: Record<string, string>;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validationError = validateRunRequest(body);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  const req = body as RunRequest;
  // Default to "review_plan" for backward compatibility — existing API callers
  // (MCP, scripts) that predate the workflow field expect review_plan behavior.
  // The UI always sends workflow explicitly (defaults to "general" in store).
  const workflow = req.workflow ?? "review_plan";

  const providers = req.models.map((id) =>
    toProviderWithConfig(id, req.apiKeys[id]!, req.modelOverrides?.[id]),
  );
  const synthesizer = toProviderWithConfig(
    req.synthesizer,
    req.apiKeys[req.synthesizer]!,
    req.modelOverrides?.[req.synthesizer],
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
        let result: WorkflowResult;
        if (workflow === "review_plan") {
          result = await reviewPlan({
            plan: req.prompt,
            context: req.context,
            providers,
            synthesizer,
            onProgress: sendEvent,
          });
        } else if (workflow === "general") {
          result = await general({
            prompt: req.prompt,
            context: req.context,
            providers,
            synthesizer,
            onProgress: sendEvent,
          });
        } else {
          // Validator rejects unknown values, but guard defensively
          sendEvent({ stage: "done", status: "error", error: `Unknown workflow: ${workflow}` });
          if (!closed) {
            try { controller.close(); } catch { /* already closed */ }
          }
          return;
        }

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
