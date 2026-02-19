"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsortiumInput } from "@/components/ConsortiumInput";
import { StageProgress } from "@/components/StageProgress";
import { ResponseTabs } from "@/components/ResponseTabs";
import { ReviewDisplay } from "@/components/ReviewDisplay";
import { SynthesisView } from "@/components/SynthesisView";
import { createConsortiumStore } from "@/store/consortium";
import { getKeysStore } from "@/store/keys";

const keysStore = getKeysStore();

const consortiumStore = createConsortiumStore({
  getKeys: () => keysStore.getState().getKeys(),
});

export function ConsortiumPage() {
  const runStatus = useStore(consortiumStore, (s) => s.runStatus);
  const reviewStage = useStore(consortiumStore, (s) => s.stages.review.status);
  const synthesisStage = useStore(consortiumStore, (s) => s.stages.synthesis.status);
  const errorMessage = useStore(consortiumStore, (s) => s.errorMessage);

  // User tab override — null means "follow auto-tab"
  const [userTab, setUserTab] = useState<string | null>(null);

  // Reset user override when a new run starts.
  // useState for prev-value tracking is the React-recommended pattern for
  // adjusting state during render (avoids useEffect + setState and useRef during render).
  const [prevRunStatus, setPrevRunStatus] = useState(runStatus);
  if (runStatus !== prevRunStatus) {
    setPrevRunStatus(runStatus);
    if (runStatus === "running") {
      setUserTab(null);
    }
  }

  // Derive auto-tab from stage statuses ("drafts" is the default)
  let autoTab = "drafts";
  if (synthesisStage === "running" || synthesisStage === "complete") {
    autoTab = "synthesis";
  } else if (reviewStage === "running" || reviewStage === "complete" || reviewStage === "partial") {
    autoTab = "reviews";
  }

  const activeTab = userTab ?? autoTab;

  const handleTabChange = (value: string) => {
    setUserTab(value);
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
