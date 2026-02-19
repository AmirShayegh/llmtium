"use client";

import { useStore } from "zustand";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { ConsortiumState } from "@/store/consortium";
import type { CrossReview, Disagreement } from "@llmtium/core";
import type { StoreApi } from "zustand";

interface ReviewDisplayProps {
  store: StoreApi<ConsortiumState>;
}

function resolveLabel(label: string, mapping: Record<string, string> | null): string {
  if (!mapping) return label;
  const modelId = mapping[label];
  if (!modelId) return label;
  return PROVIDER_META[modelId]?.name ?? modelId;
}

const SCORE_LABELS = ["correctness", "completeness", "actionability", "clarity"] as const;

function ScoreRow({
  responseLabel,
  scores,
  mapping,
}: {
  responseLabel: string;
  scores: { correctness: number; completeness: number; actionability: number; clarity: number };
  mapping: Record<string, string> | null;
}) {
  const resolved = resolveLabel(responseLabel, mapping);
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {resolved}
      </span>
      {SCORE_LABELS.map((dim) => (
        <span key={dim} className="font-mono text-xs tabular-nums">
          <span className="text-muted-foreground/60">{dim.slice(0, 4)}</span>{" "}
          <span className="text-foreground">{Number(scores[dim])}</span>
        </span>
      ))}
    </div>
  );
}

function DisagreementCard({
  disagreement,
  mapping,
}: {
  disagreement: Disagreement;
  mapping: Record<string, string> | null;
}) {
  return (
    <div className="space-y-2 border-l-2 border-amber-500/40 pl-3">
      <p className="text-xs font-medium text-foreground">{disagreement.topic}</p>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{resolveLabel(disagreement.a.response_id, mapping)}</span>:{" "}
          <span className="italic">&ldquo;{disagreement.a.quote}&rdquo;</span>
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{resolveLabel(disagreement.b.response_id, mapping)}</span>:{" "}
          <span className="italic">&ldquo;{disagreement.b.quote}&rdquo;</span>
        </p>
      </div>
      <p className="text-xs text-foreground/80">{disagreement.assessment}</p>
      {disagreement.suggested_resolution && (
        <p className="text-xs text-muted-foreground">
          Resolution: {disagreement.suggested_resolution}
        </p>
      )}
    </div>
  );
}

function ReviewCard({
  modelId,
  review,
  mapping,
}: {
  modelId: string;
  review: CrossReview;
  mapping: Record<string, string> | null;
}) {
  const reviewerName = PROVIDER_META[modelId]?.name ?? modelId;

  return (
    <div className="space-y-4 rounded-sm border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-medium text-foreground">
          {reviewerName}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          confidence {Number(review.confidence).toFixed(2)}
        </span>
      </div>

      {/* Scores */}
      <div className="space-y-1">
        {review.scores.map((s) => (
          <ScoreRow key={s.response_id} responseLabel={s.response_id} scores={s} mapping={mapping} />
        ))}
      </div>

      {/* Disagreements */}
      {review.disagreements.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Disagreements
          </h4>
          {review.disagreements.map((d, i) => (
            <DisagreementCard key={i} disagreement={d} mapping={mapping} />
          ))}
        </div>
      )}

      {/* Issues */}
      {review.issues.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Issues
          </h4>
          <ul className="space-y-0.5">
            {review.issues.map((issue, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                &bull; {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Missing info */}
      {review.missing_info.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Missing Info
          </h4>
          <ul className="space-y-0.5">
            {review.missing_info.map((info, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                &bull; {info}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ReviewDisplay({ store }: ReviewDisplayProps) {
  const reviews = useStore(store, (s) => s.reviews);
  const mapping = useStore(store, (s) => s.mapping);
  const reviewModels = useStore(store, (s) => s.stages.review.models);

  const entries = Object.entries(reviews);
  if (entries.length === 0) {
    const hasRunning = Object.values(reviewModels).some((s) => s === "running");
    if (hasRunning) {
      return (
        <p className="animate-pulse text-sm text-muted-foreground">
          Collecting reviews...
        </p>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      {entries.map(([modelId, review]) => (
        <ReviewCard key={modelId} modelId={modelId} review={review} mapping={mapping} />
      ))}
    </div>
  );
}
