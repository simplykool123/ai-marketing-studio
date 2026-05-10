import type { SkillConfig } from "@workspace/db/schema";

export type QualityReport = {
  checks: {
    hasCTA: boolean;
    hasContent: boolean;
    structureValid: boolean;
    basicQuality: boolean;
  };
  notes: string[];
};

export type QualityResult = {
  score: number;
  report: QualityReport;
};

type SkillConfigBody = {
  output_schema?: {
    required?: string[];
  };
};

function textValue(output: Record<string, unknown>, keys: string[]): string {
  return keys
    .map((key) => output[key])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}

function requiredFields(skill: SkillConfig): string[] {
  const config = (skill.config ?? {}) as SkillConfigBody;
  return Array.isArray(config.output_schema?.required)
    ? config.output_schema.required.filter((field): field is string => typeof field === "string")
    : [];
}

export function evaluateQuality({
  skill,
  output,
}: {
  skill: SkillConfig;
  output: Record<string, unknown>;
}): QualityResult {
  const notes: string[] = [];
  const cta = output.cta;
  const contentText = textValue(output, ["caption", "body", "fullDraft", "voiceoverFull", "preheader", "metaDescription"]);
  const required = requiredFields(skill);

  const hasCTA = typeof cta === "string" && cta.trim().length > 0;
  const hasContent = contentText.length > 0;
  const structureValid = required.length > 0
    ? required.every((field) => output[field] !== undefined && output[field] !== null && String(output[field]).trim().length > 0)
    : Object.keys(output).length > 0;
  const basicQuality = contentText.length > 80;

  if (!hasCTA) notes.push("Missing CTA.");
  if (!hasContent) notes.push("Missing main content.");
  if (!structureValid) notes.push("Missing one or more required output fields.");
  if (!basicQuality) notes.push("Main content is short.");
  if (notes.length === 0) notes.push("Passed basic deterministic quality checks.");

  const checks = {
    hasCTA,
    hasContent,
    structureValid,
    basicQuality,
  };
  const passed = Object.values(checks).filter(Boolean).length;

  return {
    score: passed / Object.keys(checks).length,
    report: {
      checks,
      notes,
    },
  };
}
