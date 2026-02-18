import Link from "next/link";
import { ConsortiumPage } from "@/components/ConsortiumPage";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="font-mono text-lg font-bold tracking-tight text-foreground">
            LLMtium
          </h1>
          <Link
            href="/settings"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <ConsortiumPage />
      </main>
    </div>
  );
}
