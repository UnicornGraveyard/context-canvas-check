import { describe, expect, it } from "vitest";
import { CHECK_TITLES, CONFIG_CHECKS, groupFindings, summarizeFindings, type ConfigFinding } from "../index";

const finding = (file: string, overrides: Partial<ConfigFinding> = {}): ConfigFinding => ({
  check: "agent-not-loaded",
  severity: "error",
  file,
  message: `${file} won't load.`,
  detail: "The frontmatter block is not closed.",
  fix: "Add a closing --- line.",
  docs: "https://code.claude.com/docs/en/sub-agents",
  reports: ["R16"],
  ...overrides,
});

describe("summarizeFindings", () => {
  it("counts findings per severity, zeros included", () => {
    expect(summarizeFindings([])).toEqual({ error: 0, warning: 0, info: 0 });
    expect(summarizeFindings([finding("a.md"), finding("b.md", { severity: "info" }), finding("c.md")])).toEqual({ error: 2, warning: 0, info: 1 });
  });
});

describe("groupFindings", () => {
  it("groups 3 or more findings with the same severity, check, detail and fix where the first one was", () => {
    const [a, b, c] = ["a.md", "b.md", "c.md"].map((file) => finding(file));
    const other = finding("settings.json", { check: "file-does-not-parse", detail: "Parser error." });
    const differentFix = finding("d.md", { fix: "Remove hooks." });
    expect(groupFindings([other, a, differentFix, b, c])).toEqual([[other], [a, b, c], [differentFix]]);
  });

  it("keeps pairs apart and tells severities apart", () => {
    const pair = [finding("a.md"), finding("b.md")];
    expect(groupFindings(pair)).toEqual([[pair[0]], [pair[1]]]);
    const mixed = [finding("a.md"), finding("b.md", { severity: "warning" }), finding("c.md")];
    expect(groupFindings(mixed)).toEqual(mixed.map((item) => [item]));
  });

  it("groups findings without detail or fix by what they share", () => {
    const bare = ["a.md", "b.md", "c.md"].map((file) => finding(file, { detail: undefined, fix: undefined }));
    expect(groupFindings([...bare, finding("d.md")])).toEqual([bare, [finding("d.md")]]);
  });
});

describe("CHECK_TITLES", () => {
  it("titles every check, and drift findings", () => {
    for (const check of CONFIG_CHECKS) expect(CHECK_TITLES.get(check.id)).toBe(check.title);
    expect(CHECK_TITLES.get("config-drift")).toBe("Changed since the last baseline");
    expect(CHECK_TITLES.size).toBe(CONFIG_CHECKS.length + 1);
  });
});
