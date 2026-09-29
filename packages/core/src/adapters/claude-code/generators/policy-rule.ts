import type { IRRule } from "../../../ir/types";

/**
 * A rule's body as markdown lines (content, then Expected Inputs/Outputs and
 * Pre/Postconditions from its metadata), without a title heading.
 */
export function ruleBodyLines(policy: IRRule): string[] {
  const metadata = (policy.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];

  if (policy.content) {
    parts.push(policy.content);
    parts.push("");
  }

  const inputs = metadata.inputs as Array<{ name: string; description: string; required: boolean }> | undefined;
  const outputs = metadata.outputs as Array<{ name: string; description: string }> | undefined;
  const preconditions = metadata.preconditions as string[] | undefined;
  const postconditions = metadata.postconditions as string[] | undefined;

  if (inputs && inputs.length > 0) {
    parts.push("## Expected Inputs");
    parts.push("");
    for (const input of inputs) {
      const req = input.required ? " (required)" : " (optional)";
      parts.push(`- **${input.name}**${req}: ${input.description}`);
    }
    parts.push("");
  }

  if (outputs && outputs.length > 0) {
    parts.push("## Expected Outputs");
    parts.push("");
    for (const output of outputs) {
      parts.push(`- **${output.name}**: ${output.description}`);
    }
    parts.push("");
  }

  if (preconditions && preconditions.length > 0) {
    parts.push("## Preconditions");
    parts.push("");
    for (const condition of preconditions) {
      parts.push(`- ${condition}`);
    }
    parts.push("");
  }

  if (postconditions && postconditions.length > 0) {
    parts.push("## Postconditions");
    parts.push("");
    for (const condition of postconditions) {
      parts.push(`- ${condition}`);
    }
    parts.push("");
  }

  return parts;
}

export function generatePolicyRuleFile(policy: IRRule): { path: string; content: string } {
  // Claude Code rules files only support an optional "paths" frontmatter field.
  // The contract content itself IS the rule; no other frontmatter is recognized.
  const parts = [`# ${policy.title}`, "", ...ruleBodyLines(policy)];

  return {
    path: `.claude/rules/${policy.slug}.md`,
    content: parts.join("\n").trimEnd() + "\n",
  };
}
