"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "zustand";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { initCrypto, encrypt } from "@/lib/crypto";
import { getKeysStore } from "@/store/keys";
import type { KeyStatus } from "@/store/keys";

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openai", name: "OpenAI", placeholder: "sk-..." },
  { id: "google", name: "Google", placeholder: "AI..." },
] as const;

const store = getKeysStore();

function StatusDot({ status }: { status: KeyStatus }) {
  const base = "inline-block h-2 w-2 rounded-full";
  switch (status) {
    case "untested":
      return <span className={`${base} bg-zinc-600`} />;
    case "validating":
      return <span className={`${base} bg-amber-500 animate-pulse`} />;
    case "valid":
      return <span className={`${base} bg-emerald-500`} />;
    case "invalid":
      return <span className={`${base} bg-red-500`} />;
  }
}

function ProviderRow({ id, name, placeholder }: { id: string; name: string; placeholder: string }) {
  const providerState = useStore(store, (s) => s.providers[id]!);
  const setEncryptedKey = useStore(store, (s) => s.setEncryptedKey);
  const setStatus = useStore(store, (s) => s.setStatus);
  const removeKey = useStore(store, (s) => s.removeKey);

  const [input, setInput] = useState("");
  const [validatedKey, setValidatedKey] = useState<string | null>(null);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setValidatedKey(null);
    if (value) {
      setStatus(id, "untested");
    }
  }, [id, setStatus]);

  const handleValidate = useCallback(async () => {
    if (!input.trim()) return;

    setStatus(id, "validating");
    try {
      const res = await fetch("/api/keys/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey: input }),
      });
      const data = await res.json() as { valid: boolean; error?: string };

      if (data.valid) {
        setStatus(id, "valid");
        setValidatedKey(input);
      } else {
        setStatus(id, "invalid", data.error ?? "Invalid key");
        setValidatedKey(null);
      }
    } catch {
      setStatus(id, "invalid", "Network error");
      setValidatedKey(null);
    }
  }, [id, input, setStatus]);

  const handleSave = useCallback(async () => {
    if (!validatedKey || input !== validatedKey) return;
    try {
      const encrypted = await encrypt(input);
      setEncryptedKey(id, encrypted);
      setInput("");
      setValidatedKey(null);
    } catch {
      setStatus(id, "invalid", "Failed to encrypt key");
    }
  }, [id, input, validatedKey, setEncryptedKey, setStatus]);

  const handleRemove = useCallback(() => {
    removeKey(id);
    setInput("");
    setValidatedKey(null);
  }, [id, removeKey]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleValidate();
      }
    },
    [handleValidate],
  );

  const isConfigured = providerState.encryptedKey !== null;
  const canSave = validatedKey !== null && input === validatedKey;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusDot status={providerState.status} />
        <Label className="font-mono text-sm font-medium text-foreground">
          {name}
        </Label>
        {isConfigured && !input && (
          <span className="ml-auto text-xs text-muted-foreground">
            Key configured
            <button
              onClick={handleRemove}
              className="ml-2 text-destructive hover:underline"
            >
              Remove
            </button>
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={isConfigured && !input ? "Enter new key to replace" : placeholder}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 font-mono text-sm"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleValidate}
          disabled={!input.trim() || providerState.status === "validating"}
        >
          Validate
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
        >
          Save
        </Button>
      </div>
      {providerState.status === "invalid" && providerState.error && (
        <p className="text-xs text-destructive">{providerState.error}</p>
      )}
    </div>
  );
}

export function KeySetup() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initCrypto(localStorage);
    setReady(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time client-only init
  }, []);

  if (!ready) return null;

  return (
    <div className="space-y-8">
      {PROVIDERS.map((p) => (
        <ProviderRow key={p.id} id={p.id} name={p.name} placeholder={p.placeholder} />
      ))}
    </div>
  );
}
