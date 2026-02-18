import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="flex flex-col items-center gap-4">
        <h1 className="font-mono text-4xl font-bold tracking-tight">
          LLMtium
        </h1>
        <p className="text-muted-foreground">
          Multi-LLM deliberation, cross-referencing, and synthesis
        </p>
        <Link
          href="/settings"
          className="mt-4 text-sm text-primary hover:underline"
        >
          Configure API Keys
        </Link>
      </main>
    </div>
  );
}
