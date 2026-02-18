// Keys are ephemeral — used for this request only, never stored or logged

import { resolveProvider } from "@/lib/providers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  if (typeof body.provider !== "string" || body.provider.length === 0) {
    return Response.json({ error: "provider is required" }, { status: 400 });
  }

  if (typeof body.apiKey !== "string" || body.apiKey.length === 0) {
    return Response.json({ error: "apiKey is required" }, { status: 400 });
  }

  const provider = resolveProvider(body.provider);
  if (!provider) {
    return Response.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 });
  }

  const result = await provider.validateKey({ apiKey: body.apiKey });

  if (result.success) {
    return Response.json({ valid: true });
  }
  return Response.json({ valid: false, error: result.error });
}
