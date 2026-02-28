import { ExternalLink } from "lucide-react";

export function HeroSection() {
  return (
    <section className="space-y-3 pb-2">
      <h2 className="font-mono text-2xl font-bold tracking-tight text-primary">
        Not consensus. Clarity.
      </h2>

      <p className="text-sm font-medium text-foreground">
        Three models draft independently, critique each other blind, and surface
        every disagreement that matters.
      </p>

      <div className="flex items-start justify-between gap-6">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Send your prompt to Claude, GPT, and Gemini in parallel. A synthesizer
          resolves what matters. BYOK. Self-hostable. Open source.
        </p>

        <a
          href="https://github.com/AmirShayegh/llmtium"
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          <span className="font-mono">GitHub</span>
        </a>
      </div>

      <div className="border-b border-border" />
    </section>
  );
}
