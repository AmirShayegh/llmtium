"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "zustand";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { initCrypto } from "@/lib/crypto";
import { createKeysStore } from "@/store/keys";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { ConsortiumState } from "@/store/consortium";
import type { StoreApi } from "zustand";

const keysStore = createKeysStore();

interface ConsortiumInputProps {
  store: StoreApi<ConsortiumState>;
}

export function ConsortiumInput({ store }: ConsortiumInputProps) {
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState("");

  const runStatus = useStore(store, (s) => s.runStatus);
  const startRun = useStore(store, (s) => s.startRun);
  const configuredIds = useStore(keysStore, (s) => s.getConfiguredProviderIds());
  const hasValid = useStore(keysStore, (s) => s.hasValidKeys());

  useEffect(() => {
    initCrypto(localStorage);
    setReady(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time client-only init
  }, []);

  const handleRun = useCallback(() => {
    if (!prompt.trim() || !hasValid || runStatus === "running") return;
    // Prefer anthropic as synthesizer if available, else first configured
    const synthesizer = configuredIds.includes("anthropic")
      ? "anthropic"
      : configuredIds[0]!;
    startRun(prompt.trim(), configuredIds, synthesizer);
  }, [prompt, hasValid, runStatus, configuredIds, startRun]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun],
  );

  if (!ready) return null;

  const isRunning = runStatus === "running";
  const canRun = prompt.trim().length > 0 && hasValid && !isRunning;

  return (
    <div className={`space-y-4 ${isRunning ? "opacity-60" : ""}`}>
      <Textarea
        placeholder="Enter your plan or prompt for deliberation..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isRunning}
        className="min-h-[160px] resize-y font-mono text-sm"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {Object.entries(PROVIDER_META).map(([id, meta]) => {
            const configured = configuredIds.includes(id);
            return (
              <span
                key={id}
                className={`flex items-center gap-1.5 text-xs ${
                  configured ? "text-foreground" : "text-muted-foreground/50"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    configured ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                />
                {meta.name}
              </span>
            );
          })}
          {!hasValid && (
            <Link
              href="/settings"
              className="text-xs text-primary hover:underline"
            >
              Configure keys
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {isRunning ? "" : "\u2318\u23CE"}
          </span>
          <Button onClick={handleRun} disabled={!canRun} size="sm">
            {isRunning ? "Running..." : "Run Consortium"}
          </Button>
        </div>
      </div>
    </div>
  );
}
