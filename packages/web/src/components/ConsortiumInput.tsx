"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useStore } from "zustand";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { initCrypto } from "@/lib/crypto";
import { getKeysStore } from "@/store/keys";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { ConsortiumState } from "@/store/consortium";
import type { WorkflowType } from "@llmtium/core";
import type { StoreApi } from "zustand";

const keysStore = getKeysStore();

function selectConfiguredKeys(s: { providers: Record<string, { encryptedKey: string | null }> }) {
  return Object.entries(s.providers)
    .filter(([, p]) => p.encryptedKey !== null)
    .map(([id]) => id)
    .join(",");
}

const WORKFLOW_OPTIONS: { value: WorkflowType; label: string; placeholder: string }[] = [
  { value: "general", label: "General", placeholder: "Enter your prompt for deliberation..." },
  { value: "review_plan", label: "Plan Review", placeholder: "Enter your plan for review..." },
];

interface ConsortiumInputProps {
  store: StoreApi<ConsortiumState>;
}

export function ConsortiumInput({ store }: ConsortiumInputProps) {
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState("");

  const runStatus = useStore(store, (s) => s.runStatus);
  const startRun = useStore(store, (s) => s.startRun);
  const workflow = useStore(store, (s) => s.workflow);
  const setWorkflow = useStore(store, (s) => s.setWorkflow);
  const configuredKeysStr = useStore(keysStore, selectConfiguredKeys);
  const configuredIds = useMemo(
    () => (configuredKeysStr ? configuredKeysStr.split(",") : []),
    [configuredKeysStr],
  );
  const hasValid = configuredIds.length >= 2;

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
    startRun(prompt.trim(), configuredIds, synthesizer, workflow);
  }, [prompt, hasValid, runStatus, configuredIds, startRun, workflow]);

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
  const currentOption = WORKFLOW_OPTIONS.find((o) => o.value === workflow) ?? WORKFLOW_OPTIONS[0]!;

  return (
    <div className={`space-y-4 ${isRunning ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-1">
        {WORKFLOW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={workflow === option.value}
            onClick={() => setWorkflow(option.value)}
            disabled={isRunning}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              workflow === option.value
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Textarea
        placeholder={currentOption.placeholder}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isRunning}
        className="min-h-[160px] max-h-[400px] resize-y overflow-y-auto font-mono text-sm"
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
