import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../../../ir/compile";
import { claudeCodeAdapter } from "../index";
import { parseFrontmatter } from "../frontmatter";
import { GATE_SCRIPT_PATH, LIFECYCLE_JSON_PATH } from "../generators/lifecycle";

type Atom = { id: string; type: string; title: string; content: string; metadata: unknown };
const atom = (id: string, type: string, title: string, metadata: unknown = null): Atom => ({ id, type, title, content: `${title}.`, metadata });
let n = 0;
const edge = (sourceAtomId: string, targetAtomId: string, label: string, metadata?: unknown) => ({
  id: `e${(n += 1)}`,
  sourceAtomId,
  targetAtomId,
  label,
  ...(metadata ? { metadata } : {}),
});

/** Plan (approval gate) -> Build (check + rubric gates, 2 revisions max). */
function blueprint() {
  const atoms = [
    atom("planner", "AGENT_CLASS", "Planner"),
    atom("builder", "AGENT_CLASS", "Builder"),
    atom("reviewer", "AGENT_CLASS", "Reviewer"),
    atom("plan", "STAGE", "Plan", { kind: "PLANNING", exitCriteria: ["Plan written"] }),
    atom("build", "STAGE", "Build", { kind: "CONSTRUCTION", maxIterations: 2 }),
    atom("g-approve", "GATE", "Plan approval", { gateType: "HUMAN_APPROVAL", requiredEvidence: ["plan.md reviewed"] }),
    atom("g-tests", "GATE", "Tests", { gateType: "CHECK", command: "exit 0", timeoutSec: 30 }),
    atom("g-quality", "GATE", "Quality", { gateType: "OUTCOME_RUBRIC", rubric: { criteria: ["Every task has a test", "No TODOs remain"] } }),
  ];
  const edges = [
    edge("plan", "build", "NEXT"),
    edge("planner", "plan", "ASSIGNED_TO", { role: "LEAD" }),
    edge("builder", "build", "ASSIGNED_TO", { role: "LEAD" }),
    edge("reviewer", "build", "ASSIGNED_TO", { role: "CONTRIBUTOR" }),
    edge("plan", "g-approve", "GATED_BY"),
    edge("build", "g-tests", "GATED_BY"),
    edge("build", "g-quality", "GATED_BY"),
  ];
  return compile({ atoms, edges }, { name: "Gated" }).ir;
}

describe("lifecycle emission for Claude Code", () => {
  const ir = blueprint();
  const { files, fidelity } = claudeCodeAdapter.emit(ir);
  let root: string;

  const run = (args: string[], stdin: unknown = {}) =>
    spawnSync(process.execPath, [join(root, GATE_SCRIPT_PATH), ...args], {
      cwd: root,
      input: JSON.stringify(stdin),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });

  const setCheckCommand = (command: string) => {
    const path = join(root, LIFECYCLE_JSON_PATH);
    const lifecycle = JSON.parse(readFileSync(path, "utf8"));
    lifecycle.stages[1].gates.find((gate: { slug: string }) => gate.slug === "tests").command = command;
    writeFileSync(path, JSON.stringify(lifecycle));
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cc-lifecycle-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("writes the lifecycle, the gate runtime and one approval skill per approval gate", () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([LIFECYCLE_JSON_PATH, GATE_SCRIPT_PATH, ".claude/skills/approve-gate-plan-approval/SKILL.md"])
    );
    expect(spawnSync(process.execPath, ["--check", join(root, GATE_SCRIPT_PATH)]).status).toBe(0);
    const skill = parseFrontmatter(files[".claude/skills/approve-gate-plan-approval/SKILL.md"]);
    expect(skill).toMatchObject({ name: "approve-gate-plan-approval", "disable-model-invocation": true });
    expect(files[".claude/skills/approve-gate-plan-approval/SKILL.md"]).toContain(`approve plan-approval\``);
  });

  it("puts a Stop hook on leads with automated gates and a guard on later stages' agents", () => {
    const hooksOf = (slug: string) => parseFrontmatter(files[`.claude/agents/${slug}.md`])?.hooks as Record<string, unknown> | undefined;
    expect(hooksOf("planner")).toBeUndefined();
    expect(hooksOf("builder")).toEqual({
      Stop: [{ hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${GATE_SCRIPT_PATH}" stop builder`, timeout: 60 }] }],
      PreToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash", hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${GATE_SCRIPT_PATH}" guard builder` }] }],
    });
    expect(Object.keys(hooksOf("reviewer") ?? {})).toEqual(["PreToolUse"]);
    expect(files["CLAUDE.md"]).toContain("## Lifecycle");
    expect(files["CLAUDE.md"]).toContain("/approve-gate-plan-approval");
  });

  it("blocks later stages until a person approves, and never lets agents write approvals", () => {
    const blocked = run(["guard", "builder"], { tool_name: "Write", tool_input: { file_path: join(root, "src/app.ts") } });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("/approve-gate-plan-approval");

    const forged = run(["guard", "planner"], { tool_name: "Write", tool_input: { file_path: join(root, ".context-canvas/approvals/plan-approval.json") } });
    expect(forged.status).toBe(2);

    const approved = run(["approve", "plan-approval"]);
    expect(approved.status).toBe(0);
    const record = JSON.parse(readFileSync(join(root, ".context-canvas/approvals/plan-approval.json"), "utf8"));
    expect(record).toMatchObject({ gate: "plan-approval", stage: "plan" });
    expect(record.approvedAt).toMatch(/^\d{4}-/);

    expect(run(["guard", "builder"], { tool_name: "Edit", tool_input: { file_path: join(root, "src/app.ts") } }).status).toBe(0);
    // Agents of the first stage are never guarded by it.
    expect(run(["guard", "planner"], { tool_name: "Bash", tool_input: { command: "ls" } }).status).toBe(0);
  });

  it("sends the lead back when a check fails, then escalates after the revision limit", () => {
    setCheckCommand("echo boom; exit 3");
    const first = run(["stop", "builder"]);
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('Gate "Tests" failed');
    expect(first.stderr).toContain("boom");
    expect(first.stderr).toContain("attempt 1 of 2");

    const second = run(["stop", "builder"]);
    expect(second.status).toBe(0);
    expect(second.stderr).toContain("still fail after 2 attempts");
  });

  it("requires a ticked rubric self-assessment", () => {
    setCheckCommand("exit 0");
    const missing = run(["stop", "builder"]);
    expect(missing.status === 2 || missing.status === 0).toBe(true);
    // The attempt counter was escalated above; reset it to test the rubric on its own.
    rmSync(join(root, ".context-canvas/state"), { recursive: true, force: true });
    const needsAssessment = run(["stop", "builder"]);
    expect(needsAssessment.status).toBe(2);
    expect(needsAssessment.stderr).toContain("- [ ] Every task has a test");

    const resetAttempts = () => rmSync(join(root, ".context-canvas/state"), { recursive: true, force: true });
    resetAttempts();
    writeFileSync(join(root, ".context-canvas/evidence/quality.md"), "- [x] Every task has a test (see tests/)\n- [ ] No TODOs remain\n");
    expect(run(["stop", "builder"]).status).toBe(2);
    resetAttempts();
    writeFileSync(join(root, ".context-canvas/evidence/quality.md"), "- [x] Every task has a test\n- [x] No TODOs remain\n");
    const passed = run(["stop", "builder"]);
    expect(passed.status).toBe(0);
    expect(JSON.parse(readFileSync(join(root, ".context-canvas/evidence/tests.json"), "utf8")).passed).toBe(true);
    expect(existsSync(join(root, ".context-canvas/evidence/quality.json"))).toBe(true);

    const status = run(["status"]);
    expect(status.stdout).toContain("1. Plan / Plan approval: passed");
    expect(status.stdout).toContain("2. Build / Quality: passed");
  });

  it("reports what is native and what is approximated", () => {
    const report = fidelity.items.map((item) => [item.feature, item.level]);
    expect(report).toEqual([
      ["Stage order", "approximated"],
      ["Check gates", "native"],
      ["Human approval gates", "approximated"],
      ["Rubric gates", "approximated"],
    ]);
  });
});
