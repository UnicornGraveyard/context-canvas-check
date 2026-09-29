import type { SourceAtom, SourceEdge } from "../model/source";
import { assignedToEdgeMetadataSchema, gateMetadataSchema, stageMetadataSchema } from "../model/metadata";
import { hasCycle } from "./cycles";

export type LifecycleIssueCode =
  | "LIFECYCLE_NOT_LINEAR"
  | "LIFECYCLE_DISCONNECTED"
  | "STAGE_NO_LEAD"
  | "STAGE_MULTIPLE_LEADS"
  | "STAGE_INVALID_CONFIG"
  | "GATE_ORPHAN"
  | "GATE_MULTIPLE_STAGES"
  | "GATE_INVALID_CONFIG"
  | "CONSUMES_BEFORE_PRODUCED"
  | "STAGE_NO_EXIT";

export type LifecycleIssue = {
  code: LifecycleIssueCode;
  message: string;
  atomId?: string;
  edgeId?: string;
};

function byTitleThenId(a: SourceAtom, b: SourceAtom): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export type StageOrder = {
  /** Stages in NEXT order when the lifecycle is one chain; otherwise by title. */
  stages: SourceAtom[];
  /** Every stage has at most one NEXT and one previous stage, and there are no loops. */
  linear: boolean;
  /** Linear, and a single chain covers every stage. */
  connected: boolean;
};

export function orderStages(atoms: SourceAtom[], edges: SourceEdge[]): StageOrder {
  const stages = atoms.filter((atom) => atom.type === "STAGE").sort(byTitleThenId);
  const stageIds = new Set(stages.map((stage) => stage.id));
  const next = edges.filter((edge) => edge.label === "NEXT" && stageIds.has(edge.sourceAtomId) && stageIds.has(edge.targetAtomId));

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const edge of next) {
    outgoing.set(edge.sourceAtomId, [...(outgoing.get(edge.sourceAtomId) ?? []), edge.targetAtomId]);
    incoming.set(edge.targetAtomId, (incoming.get(edge.targetAtomId) ?? 0) + 1);
  }

  const linear =
    stages.every((stage) => (outgoing.get(stage.id)?.length ?? 0) <= 1 && (incoming.get(stage.id) ?? 0) <= 1) &&
    !hasCycle(next, "NEXT");
  if (!linear) return { stages, linear: false, connected: false };

  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const heads = stages.filter((stage) => !incoming.has(stage.id));
  const ordered: SourceAtom[] = [];
  for (const head of heads) {
    let current: SourceAtom | undefined = head;
    while (current) {
      ordered.push(current);
      const nextId: string | undefined = outgoing.get(current.id)?.[0];
      current = nextId ? byId.get(nextId) : undefined;
    }
  }
  return { stages: ordered, linear: true, connected: heads.length <= 1 };
}

/** True when an ASSIGNED_TO edge makes its agent the stage lead. */
export function isLeadAssignment(edge: SourceEdge & { metadata?: unknown }): boolean {
  const parsed = assignedToEdgeMetadataSchema.safeParse(edge.metadata ?? {});
  return parsed.success && parsed.data.role === "LEAD";
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "invalid metadata";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Lifecycle diagnostics. Nothing is reported for blueprints without stages
 * or gates, so existing OO-only blueprints are unaffected.
 */
export function lintLifecycle(
  atoms: SourceAtom[],
  edges: Array<SourceEdge & { metadata?: unknown }>
): { errors: LifecycleIssue[]; warnings: LifecycleIssue[] } {
  const errors: LifecycleIssue[] = [];
  const warnings: LifecycleIssue[] = [];
  const stages = atoms.filter((atom) => atom.type === "STAGE");
  const gates = atoms.filter((atom) => atom.type === "GATE");
  if (stages.length === 0 && gates.length === 0) return { errors, warnings };

  const order = orderStages(atoms, edges);
  if (!order.linear) {
    errors.push({
      code: "LIFECYCLE_NOT_LINEAR",
      message:
        "Stages must form one chain: each stage has at most one NEXT stage and one previous stage, with no loops. Model revision loops in gate outcomes, not NEXT edges.",
    });
  } else if (!order.connected) {
    errors.push({
      code: "LIFECYCLE_DISCONNECTED",
      message: `The ${stages.length} stages are not joined into one chain. Connect them with NEXT edges.`,
    });
  }

  for (const stage of stages) {
    const assignments = edges.filter((edge) => edge.label === "ASSIGNED_TO" && edge.targetAtomId === stage.id);
    const leads = assignments.filter(isLeadAssignment);
    if (leads.length === 0) {
      errors.push({
        code: "STAGE_NO_LEAD",
        message: `Stage "${stage.title}" has no lead. Assign one agent with role LEAD.`,
        atomId: stage.id,
      });
    } else if (leads.length > 1) {
      errors.push({
        code: "STAGE_MULTIPLE_LEADS",
        message: `Stage "${stage.title}" has ${leads.length} leads. Keep one LEAD; make the others CONTRIBUTOR.`,
        atomId: stage.id,
      });
    }

    const config = stageMetadataSchema.safeParse(stage.metadata ?? {});
    if (!config.success) {
      errors.push({
        code: "STAGE_INVALID_CONFIG",
        message: `Stage "${stage.title}" has invalid settings (${firstIssue(config.error)}).`,
        atomId: stage.id,
      });
    }

    const hasGate = edges.some((edge) => edge.label === "GATED_BY" && edge.sourceAtomId === stage.id);
    const exitCriteria = config.success ? config.data.exitCriteria : [];
    if (!hasGate && exitCriteria.length === 0) {
      warnings.push({
        code: "STAGE_NO_EXIT",
        message: `Stage "${stage.title}" has no exit gate or exit criteria, so its handoff is unchecked.`,
        atomId: stage.id,
      });
    }
  }

  for (const gate of gates) {
    const owners = edges.filter((edge) => edge.label === "GATED_BY" && edge.targetAtomId === gate.id);
    if (owners.length === 0) {
      errors.push({
        code: "GATE_ORPHAN",
        message: `Gate "${gate.title}" is not attached to a stage. Connect a stage to it with GATED_BY.`,
        atomId: gate.id,
      });
    } else if (owners.length > 1) {
      errors.push({
        code: "GATE_MULTIPLE_STAGES",
        message: `Gate "${gate.title}" is attached to ${owners.length} stages. A gate belongs to one stage.`,
        atomId: gate.id,
      });
    }

    const config = gateMetadataSchema.safeParse(gate.metadata ?? {});
    if (!config.success) {
      errors.push({
        code: "GATE_INVALID_CONFIG",
        message: `Gate "${gate.title}" has invalid settings (${firstIssue(config.error)}).`,
        atomId: gate.id,
      });
    }
  }

  if (order.linear) {
    const position = new Map(order.stages.map((stage, index) => [stage.id, index]));
    for (const consume of edges.filter((edge) => edge.label === "CONSUMES")) {
      const consumerAt = position.get(consume.sourceAtomId);
      if (consumerAt === undefined) continue;
      const producerAt = edges
        .filter((edge) => edge.label === "PRODUCES" && edge.targetAtomId === consume.targetAtomId)
        .map((edge) => position.get(edge.sourceAtomId))
        .filter((index): index is number => index !== undefined);
      // Artifacts no stage produces come from outside the lifecycle; that is fine.
      if (producerAt.length > 0 && Math.min(...producerAt) > consumerAt) {
        const artifact = atoms.find((atom) => atom.id === consume.targetAtomId);
        const stage = atoms.find((atom) => atom.id === consume.sourceAtomId);
        warnings.push({
          code: "CONSUMES_BEFORE_PRODUCED",
          message: `Stage "${stage?.title}" consumes "${artifact?.title}" before any stage produces it.`,
          edgeId: consume.id,
        });
      }
    }
  }

  return { errors, warnings };
}
