import { asRecord, asStringList, type JsonFile } from "./model";

/** A permission rule such as `Bash(npm test)`, `Read(./secrets/**)` or a bare `Edit`. */
export type PermissionRule = {
  list: "allow" | "ask" | "deny";
  rule: string;
  tool: string;
  spec?: string;
  settings: JsonFile;
};

export function parseRule(rule: string): { tool: string; spec?: string } {
  const match = /^([^()]+)\((.*)\)$/s.exec(rule.trim());
  return match ? { tool: match[1].trim(), spec: match[2] } : { tool: rule.trim() };
}

export function permissionRules(settings: JsonFile[]): PermissionRule[] {
  const rules: PermissionRule[] = [];
  for (const file of settings) {
    const permissions = asRecord(file.data?.permissions);
    if (!permissions) continue;
    for (const list of ["allow", "ask", "deny"] as const) {
      for (const rule of asStringList(permissions[list]) ?? []) rules.push({ list, rule, ...parseRule(rule), settings: file });
    }
  }
  return rules;
}

export type HookEntry = { event: string; matcher: string; command: string; settings: JsonFile };

/** Command hooks from settings files, in the settings.json `hooks` shape. */
export function hookEntries(settings: JsonFile[]): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const file of settings) {
    const hooks = asRecord(file.data?.hooks);
    if (!hooks) continue;
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const record = asRecord(group);
        const inner = Array.isArray(record?.hooks) ? record.hooks : [];
        for (const hook of inner) {
          const command = asRecord(hook)?.command;
          entries.push({ event, matcher: typeof record?.matcher === "string" ? record.matcher : "", command: typeof command === "string" ? command : JSON.stringify(hook), settings: file });
        }
      }
    }
  }
  return entries;
}

/** Hook matchers match tool names in full; an empty matcher or `*` matches every tool. */
export function matcherMatches(matcher: string, tool: string): boolean {
  if (matcher === "" || matcher === "*") return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

/** Tools whose rules take gitignore-style path specifiers. */
export const PATH_RULE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
