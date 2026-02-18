"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/ExportButton";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { ConsortiumState } from "@/store/consortium";
import type { ResolvedDisagreement } from "@llmtium/core";
import type { StoreApi } from "zustand";

interface SynthesisViewProps {
  store: StoreApi<ConsortiumState>;
}

function resolveLabel(label: string, mapping: Record<string, string> | null): string {
  if (!mapping) return label;
  const modelId = mapping[label];
  if (!modelId) return label;
  return PROVIDER_META[modelId]?.name ?? modelId;
}

function PriorityBadge({ priority }: { priority: "P0" | "P1" | "P2" }) {
  const styles = {
    P0: "bg-red-500/20 text-red-400 hover:bg-red-500/20",
    P1: "bg-amber-500/20 text-amber-400 hover:bg-amber-500/20",
    P2: "bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/20",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${styles[priority]}`}>
      {priority}
    </Badge>
  );
}

function DisagreementSection({
  disagreement,
  mapping,
}: {
  disagreement: ResolvedDisagreement;
  mapping: Record<string, string> | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const supporting = disagreement.supporting_responses
    .map((label) => resolveLabel(label, mapping))
    .join(", ");

  return (
    <div className="border-l-2 border-border pl-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs font-medium text-foreground">
          {disagreement.topic}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-5">
          <p className="text-xs text-foreground/80">
            <span className="text-muted-foreground">Chosen:</span> {disagreement.chosen_position}
          </p>
          <p className="text-xs text-muted-foreground">
            {disagreement.rationale}
          </p>
          {supporting && (
            <p className="text-xs text-muted-foreground">
              <span className="text-muted-foreground/60">Supporting:</span> {supporting}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SynthesisView({ store }: SynthesisViewProps) {
  const synthesis = useStore(store, (s) => s.synthesis);
  const mapping = useStore(store, (s) => s.mapping);
  const synthStage = useStore(store, (s) => s.stages.synthesis);

  if (!synthesis) {
    if (synthStage.status === "running") {
      return (
        <p className="animate-pulse text-sm text-muted-foreground">
          Synthesizing...
        </p>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header with export + confidence */}
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Synthesized Output
        </h3>
        <div className="flex items-center gap-3">
          <ExportButton store={store} />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            confidence {synthesis.confidence.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Main output */}
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {synthesis.output}
      </div>

      {/* Resolved disagreements */}
      {synthesis.resolved_disagreements.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Resolved Disagreements
          </h4>
          {synthesis.resolved_disagreements.map((d, i) => (
            <DisagreementSection key={i} disagreement={d} mapping={mapping} />
          ))}
        </div>
      )}

      {/* Open questions */}
      {synthesis.open_questions.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Open Questions
          </h4>
          <ul className="space-y-1">
            {synthesis.open_questions.map((q, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                &bull; {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action items */}
      {synthesis.action_items.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Action Items
          </h4>
          <ul className="space-y-1.5">
            {synthesis.action_items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <PriorityBadge priority={item.priority} />
                <span className="text-foreground">{item.item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
