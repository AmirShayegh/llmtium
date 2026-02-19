import type { ReviewPromptParams, SynthesisPromptParams } from "../types/pipeline.js";

export const CROSS_REVIEW_SYSTEM_PROMPT = `You are a critical reviewer in a multi-expert deliberation process. You have been given a user's original prompt and multiple independent responses from other experts. Your identities are hidden from each other to ensure unbiased evaluation.

Your job is to carefully evaluate each response, surface disagreements between them, and identify what's missing. Be rigorous. Do not be generous — your critique directly improves the final output.

You MUST respond with valid JSON matching the schema below. No markdown, no preamble, no explanation outside the JSON.`;

export const SYNTHESIS_SYSTEM_PROMPT = `You are the lead synthesizer in a multi-expert deliberation process. Multiple experts have independently responded to a user's prompt, and then critically reviewed each other's work. You now have all responses and all structured reviews.

Your job is to produce the best possible final response by:
1. Merging the strongest elements from each expert's response
2. Resolving disagreements identified in the reviews (state what you chose and why)
3. Addressing issues and gaps the reviewers surfaced
4. Filling in missing information the reviewers identified
5. Being direct about what remains uncertain or unresolved

Do not be a diplomat. Do not average opinions. Take positions where the evidence supports it. Flag uncertainty where it doesn't.

You MUST respond with valid JSON matching the schema below. No markdown, no preamble, no explanation outside the JSON.`;

export function buildReviewPrompt(params: ReviewPromptParams): { systemPrompt: string; userPrompt: string } {
  const responseSections = params.responses
    .map((r) => `### ${r.label}\n\n${r.content}`)
    .join("\n\n---\n\n");

  const responseLabels = params.responses.map((r) => r.label);
  const scorePlaceholders = responseLabels
    .map((label) => `    {\n      "response_id": "${label}",\n      "correctness": "<1-5>",\n      "completeness": "<1-5>",\n      "actionability": "<1-5>",\n      "clarity": "<1-5>"\n    }`)
    .join(",\n");

  const userPrompt = `## Original Prompt\n\n${params.userPrompt}\n\n## Responses to Review\n\n${responseSections}\n\n## Your Task\n\nEvaluate these responses against the original prompt. Produce a JSON review with:\n- Scores (1-5) for each response on correctness, completeness, actionability, and clarity\n- The most important issues you found across all responses\n- Explicit disagreements between responses, with direct quotes\n- Information that is missing from ALL responses\n- Your confidence level (0-1) in your own assessment\n\nRespond with ONLY this JSON structure:\n\n{\n  "scores": [\n${scorePlaceholders}\n  ],\n  "issues": [\n    "Issue description referencing which response(s) it applies to"\n  ],\n  "disagreements": [\n    {\n      "topic": "What the disagreement is about",\n      "a": {\n        "response_id": "Response A",\n        "quote": "Exact quote from Response A"\n      },\n      "b": {\n        "response_id": "Response B",\n        "quote": "Exact quote from Response B"\n      },\n      "assessment": "Your analysis of who is more correct and why",\n      "suggested_resolution": "How to resolve this, or empty string if none"\n    }\n  ],\n  "missing_info": [\n    "Important information or consideration that no response addressed"\n  ],\n  "confidence": "<0.0-1.0>",\n  "confidence_reason": "Why you are this confident in your review",\n  "notes": "Any additional observations, or empty string if none"\n}`;

  return { systemPrompt: CROSS_REVIEW_SYSTEM_PROMPT, userPrompt };
}

export function buildSynthesisPrompt(params: SynthesisPromptParams): { systemPrompt: string; userPrompt: string } {
  const draftSections = params.drafts
    .map((d) => `### ${d.label}\n\n${d.content}`)
    .join("\n\n---\n\n");

  const reviewSections = params.reviews
    .map(({ reviewerId, review }) => {
      const scoreLines = review.scores
        .map((s) => `- ${s.response_id}: correctness=${s.correctness}, completeness=${s.completeness}, actionability=${s.actionability}, clarity=${s.clarity}`)
        .join("\n");

      const issues = review.issues.join("; ");

      const disagreementLines = review.disagreements
        .map((d) => `- ${d.topic}: ${d.a.response_id} says "${d.a.quote}" vs ${d.b.response_id} says "${d.b.quote}" — Reviewer says: ${d.assessment}`)
        .join("\n");

      const missingInfo = review.missing_info.join("; ");

      return `### Review by ${reviewerId}\n\n**Scores:**\n${scoreLines}\n\n**Issues:** ${issues}\n\n**Disagreements:**\n${disagreementLines}\n\n**Missing info:** ${missingInfo}\n\n**Reviewer confidence:** ${review.confidence} — ${review.confidence_reason}`;
    })
    .join("\n\n---\n\n");

  const userPrompt = `## Original Prompt\n\n${params.userPrompt}\n\n## Expert Responses\n\n${draftSections}\n\n## Structured Reviews\n\n${reviewSections}\n\n## Your Task\n\nSynthesize the best possible response to the original prompt. Use the reviews to guide which elements to keep, which disagreements to resolve, and what gaps to fill.\n\nRespond with ONLY this JSON structure:\n\n{\n  "output": "Your complete synthesized response to the original prompt. This is the main deliverable. Write it as if the user will only read this section. Be thorough and direct.",\n  "resolved_disagreements": [\n    {\n      "topic": "What the disagreement was about",\n      "chosen_position": "The position you chose",\n      "rationale": "Why you chose it, citing evidence from the responses",\n      "supporting_responses": ["A", "C"]\n    }\n  ],\n  "open_questions": [\n    "Things that remain genuinely uncertain or unresolved and require more information"\n  ],\n  "action_items": [\n    {\n      "priority": "P0",\n      "item": "Concrete next step the user should take"\n    }\n  ],\n  "confidence": "<0.0-1.0>",\n  "confidence_reason": "Why you are this confident in the synthesis"\n}`;

  return { systemPrompt: SYNTHESIS_SYSTEM_PROMPT, userPrompt };
}
