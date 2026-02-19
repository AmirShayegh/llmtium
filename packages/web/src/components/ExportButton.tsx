"use client";

import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToJson } from "@/lib/export-json";
import { exportToMarkdown } from "@/lib/export-markdown";
import { downloadFile } from "@/lib/download";
import type { ExportData } from "@/lib/export-json";
import type { ConsortiumState } from "@/store/consortium";
import type { StoreApi } from "zustand";

interface ExportButtonProps {
  store: StoreApi<ConsortiumState>;
}

function buildExportData(state: ConsortiumState): ExportData | null {
  if (state.runStatus !== "complete" || !state.result || !state.synthesis) return null;
  return {
    prompt: state.prompt,
    models: state.models,
    synthesizer: state.synthesizer,
    drafts: state.drafts,
    reviews: state.reviews,
    synthesis: state.synthesis,
    mapping: state.mapping,
    result: state.result,
    errors: state.result.pipeline.errors,
  };
}

export function ExportButton({ store }: ExportButtonProps) {
  const runStatus = useStore(store, (s) => s.runStatus);
  const result = useStore(store, (s) => s.result);

  const ready = runStatus === "complete" && result !== null;

  const handleJsonExport = () => {
    const data = buildExportData(store.getState());
    if (!data) return;
    const json = exportToJson(data);
    downloadFile("llmtium-export.json", json, "application/json");
  };

  const handleMarkdownExport = () => {
    const data = buildExportData(store.getState());
    if (!data) return;
    const md = exportToMarkdown(data);
    downloadFile("llmtium-export.md", md, "text/markdown");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!ready}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="mr-1.5"
          >
            <path
              d="M7 1v8m0 0L4 6m3 3l3-3M2 11h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleJsonExport}>
          Export JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleMarkdownExport}>
          Export Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
