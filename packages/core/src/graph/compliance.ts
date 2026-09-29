import type { SourceAtom as Atom, SourceEdge as Edge } from "../model/source";
import { compile } from "../ir/compile";
import { resolveComposedSkills } from "../ir/inheritance";
import { generateAgentFile } from "../adapters/claude-code/generators/agent";
import { generatePolicyRuleFile } from "../adapters/claude-code/generators/policy-rule";
import { generateSkillFile } from "../adapters/claude-code/generators/skill";

export type ClaudeComplianceIssue = {
  code:
    | "EXPORT_PATH_COLLISION"
    | "AGENT_EXPORT_INVALID"
    | "SKILL_EXPORT_INVALID"
    | "RULE_EXPORT_INVALID"
    | "MISSING_SKILL_DEPENDENCY";
  message: string;
  atomId?: string;
  path?: string;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function atomTypeName(atom: Atom): string {
  return String((atom as { type?: unknown }).type ?? "");
}

function isAtomType(atom: Atom, typeName: string): boolean {
  return atomTypeName(atom) === typeName;
}

function hasFrontmatterField(content: string, field: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return false;

  const frontmatter = match[1];
  const fieldMatcher = new RegExp(`(?:^|\\n)${escapeRegex(field)}:\\s*(.+)$`, "m");
  const fieldMatch = frontmatter.match(fieldMatcher);
  if (!fieldMatch) return false;

  const rawValue = fieldMatch[1].trim();
  if (!rawValue) return false;

  // Empty-but-present YAML values should still fail compliance.
  if (rawValue === '""' || rawValue === "''" || rawValue === "[]" || rawValue === "{}") {
    return false;
  }

  return true;
}

export function validateClaudeExportCompliance(atoms: Atom[], edges: Edge[]): {
  errors: ClaudeComplianceIssue[];
  warnings: ClaudeComplianceIssue[];
} {
  const errors: ClaudeComplianceIssue[] = [];
  const warnings: ClaudeComplianceIssue[] = [];
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const exportedPaths = new Map<
    string,
    { atomId: string; title: string; type: string; path: string }
  >();

  const { ir } = compile({ atoms, edges });

  const registerPath = (path: string, atom: { id: string; title: string; type: string }) => {
    const canonicalPath = path.toLowerCase();
    const existing = exportedPaths.get(canonicalPath);
    if (!existing) {
      exportedPaths.set(canonicalPath, {
        atomId: atom.id,
        title: atom.title,
        type: atom.type,
        path,
      });
      return;
    }

    errors.push({
      code: "EXPORT_PATH_COLLISION",
      atomId: atom.id,
      path,
      message:
        `Export path collision at ${existing.path} and ${path}: ` +
        `${existing.type} "${existing.title}" and ${atom.type} "${atom.title}" ` +
        "would overwrite each other.",
    });
  };

  for (const agent of ir.agents) {
    try {
      const file = generateAgentFile(agent, ir);
      registerPath(file.path, { ...agent, type: "AGENT_CLASS" });

      if (!hasFrontmatterField(file.content, "name") || !hasFrontmatterField(file.content, "description")) {
        errors.push({
          code: "AGENT_EXPORT_INVALID",
          atomId: agent.id,
          path: file.path,
          message: `Agent ${agent.title} exported without required frontmatter fields (name, description).`,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : "";
      errors.push({
        code: "AGENT_EXPORT_INVALID",
        atomId: agent.id,
        message: `Failed to generate export content for agent ${agent.title}${reason}.`,
      });
    }

    const missingSkillIds = new Set<string>();
    for (const skillId of resolveComposedSkills(agent.id, edges)) {
      const skillAtom = atomById.get(skillId);
      if (skillAtom && isAtomType(skillAtom, "SKILL")) continue;
      missingSkillIds.add(skillId);
    }

    for (const skillId of missingSkillIds) {
      errors.push({
        code: "MISSING_SKILL_DEPENDENCY",
        atomId: agent.id,
        message: `Agent ${agent.title} references a missing or invalid skill dependency (${skillId}).`,
      });
    }
  }

  for (const skill of ir.skills) {
    try {
      const file = generateSkillFile(skill);
      registerPath(file.path, { ...skill, type: "SKILL" });

      if (!hasFrontmatterField(file.content, "name") || !hasFrontmatterField(file.content, "description")) {
        errors.push({
          code: "SKILL_EXPORT_INVALID",
          atomId: skill.id,
          path: file.path,
          message: `Skill ${skill.title} exported without required frontmatter fields (name, description).`,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : "";
      errors.push({
        code: "SKILL_EXPORT_INVALID",
        atomId: skill.id,
        message: `Failed to generate export content for skill ${skill.title}${reason}.`,
      });
    }
  }

  for (const policyRule of ir.rules) {
    try {
      const file = generatePolicyRuleFile(policyRule);
      registerPath(file.path, { ...policyRule, type: "POLICY" });
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : "";
      errors.push({
        code: "RULE_EXPORT_INVALID",
        atomId: policyRule.id,
        message: `Failed to generate rules export for policy ${policyRule.title}${reason}.`,
      });
    }
  }

  return { errors, warnings };
}
