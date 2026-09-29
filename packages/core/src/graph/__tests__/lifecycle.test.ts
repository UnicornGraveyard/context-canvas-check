import { describe, expect, it } from "vitest";
import { lintLifecycle, orderStages } from "../lifecycle";
import { evaluateBuildGate } from "../build-gate";
import { compile } from "../../ir/compile";
import { LIFECYCLE_PRESETS, LIFECYCLE_PRESET_IDS, type LifecyclePreset } from "../../lifecycle/presets";
import { gateMetadataSchema, stageMetadataSchema } from "../../model/metadata";
import { isRelationshipLabelAllowed } from "../../model/relationships";

type Atom = { id: string; type: string; title: string; content: string; metadata: unknown };
type Edge = { id: string; sourceAtomId: string; targetAtomId: string; label: string; metadata?: unknown };

const atom = (id: string, type: string, title = id, metadata: unknown = null): Atom => ({ id, type, title, content: `${title} content`, metadata });
let edgeCount = 0;
const edge = (sourceAtomId: string, targetAtomId: string, label: string, metadata?: unknown): Edge => ({
  id: `e${(edgeCount += 1)}`,
  sourceAtomId,
  targetAtomId,
  label,
  ...(metadata === undefined ? {} : { metadata }),
});
const lead = (agent: string, stage: string) => edge(agent, stage, "ASSIGNED_TO", { role: "LEAD" });
const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code).sort();

const approvalGate = { gateType: "HUMAN_APPROVAL", requiredEvidence: ["Reviewed"] };

/** A valid two-stage lifecycle: plan -> build, each with a lead and a gate. */
function twoStage() {
  const atoms = [
    atom("agent-a", "AGENT_CLASS", "Planner"),
    atom("agent-b", "AGENT_CLASS", "Builder"),
    atom("plan", "STAGE", "Plan", { kind: "PLANNING", exitCriteria: ["Plan written"] }),
    atom("build", "STAGE", "Build", { kind: "CONSTRUCTION" }),
    atom("gate-plan", "GATE", "Plan approval", approvalGate),
    atom("gate-build", "GATE", "Tests", { gateType: "CHECK", command: "npm test" }),
    atom("spec", "ARTIFACT", "spec.md"),
  ];
  const edges = [
    edge("plan", "build", "NEXT"),
    lead("agent-a", "plan"),
    lead("agent-b", "build"),
    edge("agent-a", "build", "ASSIGNED_TO"),
    edge("plan", "gate-plan", "GATED_BY"),
    edge("build", "gate-build", "GATED_BY"),
    edge("plan", "spec", "PRODUCES"),
    edge("build", "spec", "CONSUMES"),
  ];
  return { atoms, edges };
}

/** Builds a preset's graph with one lead agent per stage, as templates do. */
function presetGraph(preset: LifecyclePreset) {
  const atoms: Atom[] = [];
  const edges: Edge[] = [];
  for (const artifact of preset.artifacts) atoms.push(atom(`artifact:${artifact.key}`, "ARTIFACT", artifact.title));
  preset.stages.forEach((stage, index) => {
    atoms.push(atom(`stage:${stage.key}`, "STAGE", stage.title, stage.metadata));
    atoms.push(atom(`agent:${stage.key}`, "AGENT_CLASS", `${stage.title} lead`));
    edges.push(lead(`agent:${stage.key}`, `stage:${stage.key}`));
    if (index > 0) edges.push(edge(`stage:${preset.stages[index - 1].key}`, `stage:${stage.key}`, "NEXT"));
    for (const gate of stage.gates) {
      atoms.push(atom(`gate:${gate.key}`, "GATE", gate.title, gate.metadata));
      edges.push(edge(`stage:${stage.key}`, `gate:${gate.key}`, "GATED_BY"));
    }
    for (const key of stage.produces) edges.push(edge(`stage:${stage.key}`, `artifact:${key}`, "PRODUCES"));
    for (const key of stage.consumes) edges.push(edge(`stage:${stage.key}`, `artifact:${key}`, "CONSUMES"));
  });
  return { atoms, edges };
}

describe("lifecycle relationships", () => {
  it("allows lifecycle edges only between the right types", () => {
    expect(isRelationshipLabelAllowed("ASSIGNED_TO", "AGENT_CLASS", "STAGE")).toBe(true);
    expect(isRelationshipLabelAllowed("ASSIGNED_TO", "SKILL", "STAGE")).toBe(false);
    expect(isRelationshipLabelAllowed("NEXT", "STAGE", "STAGE")).toBe(true);
    expect(isRelationshipLabelAllowed("NEXT", "STAGE", "GATE")).toBe(false);
    expect(isRelationshipLabelAllowed("GATED_BY", "STAGE", "GATE")).toBe(true);
    expect(isRelationshipLabelAllowed("PRODUCES", "STAGE", "ARTIFACT")).toBe(true);
    expect(isRelationshipLabelAllowed("CONSUMES", "STAGE", "FACT")).toBe(false);
    // RELATED still links knowledge to lifecycle nodes.
    expect(isRelationshipLabelAllowed("RELATED", "DECISION", "STAGE")).toBe(true);
  });
});

describe("orderStages", () => {
  it("follows the NEXT chain, not titles", () => {
    const { atoms, edges } = twoStage();
    const order = orderStages(atoms, edges);
    expect(order.stages.map((stage) => stage.id)).toEqual(["plan", "build"]);
    expect(order).toMatchObject({ linear: true, connected: true });
  });

  it("reports branches and loops as non-linear", () => {
    const atoms = [atom("a", "STAGE"), atom("b", "STAGE"), atom("c", "STAGE")];
    expect(orderStages(atoms, [edge("a", "b", "NEXT"), edge("a", "c", "NEXT")]).linear).toBe(false);
    expect(orderStages(atoms, [edge("a", "b", "NEXT"), edge("b", "c", "NEXT"), edge("c", "a", "NEXT")]).linear).toBe(false);
  });
});

describe("lintLifecycle", () => {
  it("is silent for blueprints without stages or gates", () => {
    expect(lintLifecycle([atom("x", "AGENT_CLASS")], [])).toEqual({ errors: [], warnings: [] });
  });

  it("passes a well-formed lifecycle", () => {
    const { atoms, edges } = twoStage();
    expect(lintLifecycle(atoms, edges)).toEqual({ errors: [], warnings: [] });
  });

  it("requires exactly one lead per stage", () => {
    const { atoms, edges } = twoStage();
    const noLead = edges.filter((e) => !(e.label === "ASSIGNED_TO" && e.targetAtomId === "build" && e.sourceAtomId === "agent-b"));
    expect(codes(lintLifecycle(atoms, noLead).errors)).toEqual(["STAGE_NO_LEAD"]);
    const twoLeads = [...edges.filter((e) => e.sourceAtomId !== "agent-a" || e.targetAtomId !== "build"), lead("agent-a", "build")];
    expect(codes(lintLifecycle(atoms, twoLeads).errors)).toEqual(["STAGE_MULTIPLE_LEADS"]);
  });

  it("flags disconnected, branching and looping stage graphs", () => {
    const { atoms, edges } = twoStage();
    const withoutNext = edges.filter((e) => e.label !== "NEXT");
    expect(codes(lintLifecycle(atoms, withoutNext).errors)).toEqual(["LIFECYCLE_DISCONNECTED"]);
    const looped = [...edges, edge("build", "plan", "NEXT")];
    expect(codes(lintLifecycle(atoms, looped).errors)).toEqual(["LIFECYCLE_NOT_LINEAR"]);
  });

  it("requires each gate to belong to one stage and to be configured", () => {
    const { atoms, edges } = twoStage();
    const orphan = [...atoms, atom("gate-x", "GATE", "Loose gate", approvalGate)];
    expect(codes(lintLifecycle(orphan, edges).errors)).toEqual(["GATE_ORPHAN"]);
    const shared = [...edges, edge("build", "gate-plan", "GATED_BY")];
    expect(codes(lintLifecycle(atoms, shared).errors)).toEqual(["GATE_MULTIPLE_STAGES"]);
    const badCheck = atoms.map((a) => (a.id === "gate-build" ? { ...a, metadata: { gateType: "CHECK" } } : a));
    expect(codes(lintLifecycle(badCheck, edges).errors)).toEqual(["GATE_INVALID_CONFIG"]);
  });

  it("warns about unchecked handoffs and reads before writes", () => {
    const { atoms, edges } = twoStage();
    const noExit = edges.filter((e) => !(e.label === "GATED_BY" && e.sourceAtomId === "build"));
    expect(codes(lintLifecycle(atoms, noExit).warnings)).toEqual(["STAGE_NO_EXIT"]);
    const reversed = edges
      .filter((e) => e.label !== "PRODUCES" && e.label !== "CONSUMES")
      .concat([edge("build", "spec", "PRODUCES"), edge("plan", "spec", "CONSUMES")]);
    expect(codes(lintLifecycle(atoms, reversed).warnings)).toEqual(["CONSUMES_BEFORE_PRODUCED"]);
  });

  it("blocks export through the build gate", () => {
    const { atoms, edges } = twoStage();
    const gate = evaluateBuildGate(atoms, edges.filter((e) => e.label !== "NEXT"));
    expect(gate.valid).toBe(false);
    expect(gate.errors.map((issue) => issue.code)).toContain("LIFECYCLE_DISCONNECTED");
  });
});

describe("compile lifecycle", () => {
  it("leaves lifecycle null without stages, so existing blueprints hash the same", () => {
    expect(compile({ atoms: [atom("x", "AGENT_CLASS")], edges: [] }).ir.lifecycle).toBeNull();
  });

  it("compiles stages in order with lead, contributors, gates and handoffs", () => {
    const { atoms, edges } = twoStage();
    const lifecycle = compile({ atoms, edges }).ir.lifecycle;
    expect(lifecycle?.linear).toBe(true);
    expect(lifecycle?.stages.map((stage) => [stage.order, stage.slug, stage.kind, stage.lead])).toEqual([
      [1, "plan", "PLANNING", "planner"],
      [2, "build", "CONSTRUCTION", "builder"],
    ]);
    const build = lifecycle!.stages[1];
    expect(build.contributors).toEqual(["planner"]);
    expect(build.gates.map((gate) => gate.config?.gateType)).toEqual(["CHECK"]);
    expect(build.gates[0].config).toMatchObject({ command: "npm test", timeoutSec: 300, blocking: true });
    expect(build.consumes).toEqual(["spec-md"]);
    expect(lifecycle!.stages[0].produces).toEqual(["spec-md"]);
    expect(lifecycle!.artifacts.map((artifact) => artifact.title)).toEqual(["spec.md"]);
  });
});

describe("lifecycle presets", () => {
  it.each(LIFECYCLE_PRESET_IDS)("%s has valid settings and passes the build gate once staffed", (id) => {
    const preset = LIFECYCLE_PRESETS[id];
    for (const stage of preset.stages) {
      expect(stageMetadataSchema.safeParse(stage.metadata).success).toBe(true);
      for (const gate of stage.gates) expect(gateMetadataSchema.safeParse(gate.metadata).success).toBe(true);
    }
    const { atoms, edges } = presetGraph(preset);
    expect(lintLifecycle(atoms, edges)).toEqual({ errors: [], warnings: [] });
    expect(evaluateBuildGate(atoms, edges).errors).toEqual([]);
    expect(compile({ atoms, edges }).ir.lifecycle?.stages.map((stage) => stage.title)).toEqual(preset.stages.map((stage) => stage.title));
  });

  it("names the standard stage sequences", () => {
    expect(LIFECYCLE_PRESETS.AI_DLC.stages.map((stage) => stage.title)).toEqual(["Inception", "Construction", "Operations"]);
    expect(LIFECYCLE_PRESETS.SPEC_DRIVEN.stages.map((stage) => stage.title)).toEqual(["Requirements", "Design", "Tasks", "Build", "Verify"]);
  });
});
