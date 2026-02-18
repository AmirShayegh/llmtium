export interface ResolvedDisagreement {
  topic: string;
  chosen_position: string;
  rationale: string;
  supporting_responses: string[];
}

export interface ActionItem {
  priority: "P0" | "P1" | "P2";
  item: string;
}

export interface SynthesisResponse {
  output: string;
  resolved_disagreements: ResolvedDisagreement[];
  open_questions: string[];
  action_items: ActionItem[];
  confidence: number;
  confidence_reason: string;
}
