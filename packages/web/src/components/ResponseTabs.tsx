"use client";

import { useStore } from "zustand";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { ConsortiumState } from "@/store/consortium";
import type { StoreApi } from "zustand";

interface ResponseTabsProps {
  store: StoreApi<ConsortiumState>;
}

export function ResponseTabs({ store }: ResponseTabsProps) {
  const models = useStore(store, (s) => s.models);
  const drafts = useStore(store, (s) => s.drafts);
  const draftModels = useStore(store, (s) => s.stages.draft.models);
  const errors = useStore(store, (s) => s.errors);

  if (models.length === 0) return null;

  return (
    <Tabs defaultValue={models[0]} className="w-full">
      <TabsList className="bg-muted/50">
        {models.map((id) => {
          const status = draftModels[id];
          const isFailed = status === "failed";
          return (
            <TabsTrigger
              key={id}
              value={id}
              className={isFailed ? "text-muted-foreground/50" : ""}
            >
              {PROVIDER_META[id]?.name ?? id}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {models.map((id) => {
        const status = draftModels[id];
        const content = drafts[id];
        return (
          <TabsContent key={id} value={id} className="mt-4">
            {status === "failed" ? (
              <p className="text-sm text-destructive">
                {errors.find((e) => e.stage === "draft" && e.model === id)?.error ?? "Draft failed for this model."}
              </p>
            ) : content ? (
              <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
                {content}
              </div>
            ) : (
              <p className="animate-pulse text-sm text-muted-foreground">
                Awaiting response...
              </p>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
