import { CHECK_TITLES, describeEdit, groupFindings, summarizeFindings, type ConfigFinding, type ConfigSeverity } from "@context-canvas/core/config/index";

const LABEL: Record<ConfigSeverity, string> = { error: "ERROR", warning: "WARN ", info: "NOTE " };
const LIST_AT_MOST = 12;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One finding, or a group of findings that say the same thing about different files, as one block. */
function block(members: ConfigFinding[]): string[] {
  const [first] = members;
  const lines: string[] = [];
  if (members.length === 1) {
    lines.push(`${LABEL[first.severity]}  ${first.file}${first.line ? `:${first.line}` : ""}`, `  ${first.message}`);
  } else {
    lines.push(`${LABEL[first.severity]}  ${CHECK_TITLES.get(first.check) ?? first.check}: ${members.length} files`);
  }
  if (first.detail) lines.push(`  Why: ${first.detail}`);
  if (first.fix) lines.push(`  Fix: ${first.fix}`);
  if (members.length === 1 && first.edit) lines.push(`  Edit: ${describeEdit(first.edit)}`);
  lines.push(`  Docs: ${first.docs}`);
  if (members.length > 1) {
    lines.push("  Files:", ...members.slice(0, LIST_AT_MOST).map((member) => `    ${member.file}${member.line ? `:${member.line}` : ""}`));
    if (members.length > LIST_AT_MOST) lines.push(`    ...and ${members.length - LIST_AT_MOST} more (--json lists them all)`);
  }
  return lines;
}

/** Plain text for people. Errors and warnings in full; notes only with showNotes. */
export function formatText(findings: ConfigFinding[], startDir: string, notes: string[] = [], options: { showNotes?: boolean } = {}): string {
  const counts = summarizeFindings(findings);
  const shown = options.showNotes ? findings : findings.filter((finding) => finding.severity !== "info");
  const lines = [`context-canvas-check · ${startDir}`];
  if (findings.length === 0) {
    lines.push("No problems found: everything checked will apply as written.");
  } else {
    lines.push([counts.error ? plural(counts.error, "error") : "", counts.warning ? plural(counts.warning, "warning") : "", counts.info ? plural(counts.info, "note") : ""].filter(Boolean).join(", "));
  }
  for (const members of groupFindings(shown)) lines.push("", ...block(members));
  if (!options.showNotes && counts.info > 0) {
    const byCheck = new Map<string, number>();
    for (const finding of findings) if (finding.severity === "info") byCheck.set(finding.check, (byCheck.get(finding.check) ?? 0) + 1);
    const kinds = [...byCheck].map(([check, count]) => `${count} × ${CHECK_TITLES.get(check) ?? check}`).join("; ");
    lines.push("", `${plural(counts.info, "note")} not shown (${kinds}). Add --notes to list them.`);
  }
  if (notes.length > 0) lines.push("", ...notes);
  return `${lines.join("\n")}\n`;
}

/** Compact text for a Claude Code hook: one line per error or warning. */
export function formatForHook(findings: ConfigFinding[], heading: string): string {
  const shown = findings.filter((finding) => finding.severity !== "info").slice(0, 10);
  if (shown.length === 0) return "";
  const more = findings.filter((finding) => finding.severity !== "info").length - shown.length;
  return [heading, ...shown.map((finding) => `- [${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ""}: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ""}`), ...(more > 0 ? [`- ...and ${more} more. Run \`context-canvas-check\` for all of them.`] : [])].join("\n") + "\n";
}
