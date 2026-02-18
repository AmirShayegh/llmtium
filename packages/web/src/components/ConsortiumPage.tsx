"use client";

import { useState, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsortiumInput } from "@/components/ConsortiumInput";
import { StageProgress } from "@/components/StageProgress";
import { ResponseTabs } from "@/components/ResponseTabs";
import { ReviewDisplay } from "@/components/ReviewDisplay";
import { SynthesisView } from "@/components/SynthesisView";
import { createConsortiumStore } from "@/store/consortium";
import { createKeysStore } from "@/store/keys";

const keysStore = createKeysStore();

const consortiumStore = createConsortiumStore({
  getKeys: () => keysStore.getState().getKeys(),
});

export function ConsortiumPage() {
  const runStatus = useStore(consortiumStore, (s) => s.runStatus);
  const draftStage = useStore(consortiumStore, (s) => s.stages.draft.status);
  const reviewStage = useStore(consortiumStore, (s) => s.stages.review.status);
  const synthesisStage = useStore(consortiumStore, (s) => s.stages.synthesis.status);
  const errorMessage = useStore(consortiumStore, (s) => s.errorMessage);

  const [activeTab, setActiveTab] = useState("drafts");
  const userSelected = useRef(false);

  // Auto-switch tabs as stages progress
  useEffect(() => {
    if (userSelected.current) return;

    if (synthesisStage === "running" || synthesisStage === "complete") {
      setActiveTab("synthesis");
    } else if (reviewStage === "running" || reviewStage === "complete" || reviewStage === "partial") {
      setActiveTab("reviews");
    } else if (draftStage === "running" || draftStage === "complete" || draftStage === "partial") {
      setActiveTab("drafts");
    }
  }, [draftStage, reviewStage, synthesisStage]);

  // Reset user override when a new run starts
  useEffect(() => {
    if (runStatus === "running") {
      userSelected.current = false;
    }
  }, [runStatus]);

  const handleTabChange = (value: string) => {
    userSelected.current = true;
    setActiveTab(value);
  };

  const showResults = runStatus !== "idle";

  return (
    <div className="space-y-6">
      <ConsortiumInput store={consortiumStore} />
      <StageProgress store={consortiumStore} />

      {runStatus === "error" && errorMessage && (
        <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-400">{errorMessage}</p>
        </div>
      )}

      {showResults && (
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-muted/50">
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="synthesis">Synthesis</TabsTrigger>
          </TabsList>
          <TabsContent value="drafts" className="mt-4">
            <ResponseTabs store={consortiumStore} />
          </TabsContent>
          <TabsContent value="reviews" className="mt-4">
            <ReviewDisplay store={consortiumStore} />
          </TabsContent>
          <TabsContent value="synthesis" className="mt-4">
            <SynthesisView store={consortiumStore} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
