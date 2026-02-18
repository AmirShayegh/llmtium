"use client";

import { useState, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { ConsortiumState, StageStatus, ModelStatus } from "@/store/consortium";
import type { StoreApi } from "zustand";

interface StageProgressProps {
  store: StoreApi<ConsortiumState>;
}

function ModelDot({ status }: { status: ModelStatus }) {
  const base = "inline-block h-2 w-2 rounded-full";
  switch (status) {
    case "pending":
      return <span className={`${base} bg-zinc-600`} />;
    case "running":
      return <span className={`${base} bg-amber-500 animate-pulse`} />;
    case "complete":
      return <span className={`${base} bg-emerald-500`} />;
    case "failed":
      return <span className={`${base} bg-red-500`} />;
  }
}

function StageIndicator({ status }: { status: StageStatus }) {
  const base = "inline-block h-2 w-2 rounded-full";
  switch (status) {
    case "pending":
      return <span className={`${base} bg-zinc-700`} />;
    case "running":
      return <span className={`${base} bg-amber-500 animate-pulse`} />;
    case "complete":
      return <span className={`${base} bg-emerald-500`} />;
    case "partial":
      return <span className={`${base} bg-amber-400`} />;
    case "failed":
      return <span className={`${base} bg-red-500`} />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      setElapsed(Date.now() - startedAt);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startedAt]);

  return <span className="text-muted-foreground">{formatDuration(elapsed)}</span>;
}

interface StageColumnProps {
  name: string;
  status: StageStatus;
  models: Record<string, ModelStatus>;
  durationMs: number | null;
  startedAt: number | null;
  isLast?: boolean;
}

function StageColumn({ name, status, models, durationMs, startedAt, isLast }: StageColumnProps) {
  return (
    <div className="flex flex-1 items-start gap-3">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <StageIndicator status={status} />
          <span className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {name}
          </span>
          <span className="font-mono text-xs tabular-nums">
            {durationMs !== null ? (
              formatDuration(durationMs)
            ) : status === "running" && startedAt ? (
              <LiveTimer startedAt={startedAt} />
            ) : null}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(models).map(([modelId, modelStatus]) => (
            <div key={modelId} className="flex items-center gap-1" title={PROVIDER_META[modelId]?.name ?? modelId}>
              <ModelDot status={modelStatus} />
              <span className="text-[10px] text-muted-foreground">
                {PROVIDER_META[modelId]?.name ?? modelId}
              </span>
            </div>
          ))}
        </div>
      </div>
      {!isLast && (
        <div className="flex items-center self-center px-2 text-muted-foreground/30">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function StageProgress({ store }: StageProgressProps) {
  const runStatus = useStore(store, (s) => s.runStatus);
  const stages = useStore(store, (s) => s.stages);
  const startedAt = useStore(store, (s) => s.startedAt);

  if (runStatus === "idle") return null;

  return (
    <div className="flex items-start gap-0 rounded-sm border border-border bg-card p-4">
      <StageColumn
        name="Draft"
        status={stages.draft.status}
        models={stages.draft.models}
        durationMs={stages.draft.durationMs}
        startedAt={startedAt}
      />
      <StageColumn
        name="Review"
        status={stages.review.status}
        models={stages.review.models}
        durationMs={stages.review.durationMs}
        startedAt={startedAt}
      />
      <StageColumn
        name="Synthesis"
        status={stages.synthesis.status}
        models={stages.synthesis.models}
        durationMs={stages.synthesis.durationMs}
        startedAt={startedAt}
        isLast
      />
    </div>
  );
}
