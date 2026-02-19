export interface ReviewScore {
  correctness: number;
  completeness: number;
  actionability: number;
  clarity: number;
}

export interface Disagreement {
  topic: string;
  a: { response_id: string; quote: string };
  b: { response_id: string; quote: string };
  assessment: string;
  suggested_resolution: string;
}

export interface ResponseScore extends ReviewScore {
  response_id: string;
}

export interface CrossReview {
  scores: ResponseScore[];
  issues: string[];
  disagreements: Disagreement[];
  missing_info: string[];
  confidence: number;
  confidence_reason: string;
  notes: string;
}
