import { db } from "@workspace/db";
import { skillConfigsTable, type SkillConfig } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket, type ClientMemoryPacket } from "./client-memory-packet.js";
import { resolveTextProviderForMode, type QualityMode } from "./provider-router.js";
import { generateJsonWithFallback, JsonParseError } from "./ai-json.js";
import { validatorForSkill } from "./skill-validators.js";

type SkillConfigBody = {
  prompt_template?: string;
  provider_routing?: {
    default_quality_mode?: QualityMode;
    max_tokens?: number;
  };
  save_destination?: {
    content_type?: string;
    platform?: string;
    status?: string;
  };
};

export type SkillExecutionMetadata = {
  skillId: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  repairUsed: boolean;
  generatedAt: string;
  route: "skill_engine.execute";
};

export type SkillExecutionResult = {
  skill: SkillConfig;
  output: Record<string, unknown>;
  metadata: SkillExecutionMetadata;
};

export class SkillEngineError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "SkillEngineError";
    this.status = status;
  }
}

function skillConfig(skill: SkillConfig): SkillConfigBody {
  return (skill.config ?? {}) as SkillConfigBody;
}

function valueForPath(input: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, input);

  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function parseSkillJsonOutput(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();

  // Try, in order: a single ```json fenced block, any ``` fenced block, the
  // first { … } that JSON.parse accepts. The model sometimes wraps the JSON
  // in prose; we don't want one stray sentence to fail an entire campaign.
  const fencedJson = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  const fencedAny = trimmed.match(/```\s*([\s\S]*?)\s*```/);
  const stripFence = fencedJson?.[1] ?? fencedAny?.[1] ?? trimmed;

  const candidates: string[] = [];
  if (stripFence.trim().startsWith("{")) candidates.push(stripFence.trim());

  // Walk through every { ... } block that's a balanced JSON object — start
  // at the first '{' and try increasingly long substrings until JSON.parse
  // succeeds. This handles "Here's the JSON:\n\n{...}\n\nLet me know if you
  // want adjustments." which is what Claude / GPT sometimes return.
  const firstBrace = stripFence.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    for (let i = firstBrace; i < stripFence.length; i++) {
      const ch = stripFence[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(stripFence.slice(firstBrace, i + 1));
          break;
        }
      }
    }
  }
  // Fallback: greedy match.
  const greedy = stripFence.match(/\{[\s\S]*\}/)?.[0];
  if (greedy) candidates.push(greedy);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* try the next candidate */ }
  }

  throw new SkillEngineError("Skill output was not valid JSON.", 422);
}

export async function loadSkill(skillId: string): Promise<SkillConfig> {
  const [skill] = await db
    .select()
    .from(skillConfigsTable)
    .where(and(eq(skillConfigsTable.skillId, skillId), eq(skillConfigsTable.isActive, true)))
    .limit(1);

  if (!skill) {
    throw new SkillEngineError("Skill not found or inactive.", 404);
  }

  return skill;
}

export function buildPrompt(
  skill: SkillConfig,
  memoryPacket: ClientMemoryPacket,
  input: Record<string, unknown>
): string {
  const config = skillConfig(skill);
  const template = config.prompt_template;

  if (!template?.trim()) {
    throw new SkillEngineError("Skill prompt_template is missing.", 500);
  }

  const injectedTemplate = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) =>
    valueForPath(input, key)
  );

  return [
    "You are executing a configured marketing content skill.",
    `Skill: ${skill.displayName} (${skill.skillId})`,
    "",
    "## Client Memory Packet",
    formatClientMemoryPacket(memoryPacket),
    "",
    "## Skill Input",
    JSON.stringify(input, null, 2),
    "",
    "## Skill Prompt",
    injectedTemplate,
    "",
    "Return ONLY valid JSON matching the skill output schema. Do not include markdown fences.",
  ].join("\n");
}

export async function executeSkill({
  clientId,
  skillId,
  input,
  userId,
}: {
  clientId: string;
  skillId: string;
  input: Record<string, unknown>;
  userId?: string;
}): Promise<SkillExecutionResult> {
  const skill = await loadSkill(skillId);
  const memoryPacket = await buildClientMemoryPacket(clientId);
  const prompt = buildPrompt(skill, memoryPacket, input);
  const config = skillConfig(skill);
  const qualityMode = config.provider_routing?.default_quality_mode ?? "balanced";
  const maxTokens = config.provider_routing?.max_tokens ?? 2500;
  const { provider, model } = await resolveTextProviderForMode(qualityMode, userId);

  try {
    const result = await generateJsonWithFallback({
      provider,
      model,
      prompt,
      maxTokens,
      userId,
      schemaName: skillId,
      validate: validatorForSkill(skillId),
    });
    return {
      skill,
      output: result.object,
      metadata: {
        skillId,
        provider: result.usedProvider,
        model: result.usedModel,
        fallbackUsed: result.fallbackUsed,
        repairUsed: result.repairUsed,
        generatedAt: new Date().toISOString(),
        route: "skill_engine.execute",
      },
    };
  } catch (err) {
    if (err instanceof JsonParseError) {
      throw new SkillEngineError(`Skill ${skillId} did not return valid JSON: ${err.message}`, 422);
    }
    throw err;
  }
}

export function getSkillSaveDestination(skill: SkillConfig) {
  return skillConfig(skill).save_destination ?? {};
}
