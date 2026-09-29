import type { BlueprintIR, IRSkill } from "../../../ir/types";
import { toFrontmatter } from "../frontmatter";

export function generateSkillFile(skill: IRSkill, ir?: BlueprintIR): { path: string; content: string } {
  const metadata = (skill.metadata ?? {}) as Record<string, unknown>;
  // Allow rules attached to this skill with CONFIGURES are exactly what
  // allowed-tools means: tools pre-approved while the skill runs.
  const scopedAllow = ir?.settings.scoped.skills[skill.slug]?.permissions?.allow ?? [];
  const allowedTools = [...new Set([...((metadata.allowedTools as string[] | undefined) ?? []), ...scopedAllow])];

  // Claude Code skill frontmatter uses hyphenated keys
  const frontmatterData: Record<string, unknown> = {
    name: skill.slug,
    description: skill.content.split("\n")[0].slice(0, 200),
  };

  if (allowedTools.length > 0) {
    frontmatterData["allowed-tools"] = allowedTools.join(", ");
  }
  if (metadata.model) {
    frontmatterData.model = metadata.model;
  }
  if (metadata.userInvocable === false) {
    frontmatterData["user-invocable"] = false;
  }
  if (metadata.argumentHint) {
    frontmatterData["argument-hint"] = metadata.argumentHint;
  }
  if (metadata.disableModelInvocation === true) {
    frontmatterData["disable-model-invocation"] = true;
  }
  if (metadata.context === "fork") {
    frontmatterData.context = "fork";
    if (typeof metadata.agent === "string" && metadata.agent) frontmatterData.agent = metadata.agent;
  }
  if (Array.isArray(metadata.paths) && metadata.paths.length > 0) {
    frontmatterData.paths = (metadata.paths as string[]).join(",");
  }

  const frontmatter = toFrontmatter(frontmatterData);

  return {
    path: `.claude/skills/${skill.slug}/SKILL.md`,
    content: `${frontmatter}\n\n${skill.content}`,
  };
}
