import type { SourceAtom as Atom, SourceEdge as Edge } from "../model/source";
import { validateEdgeTypeConstraint } from "./edge-rules";
import { hasCycle } from "./cycles";
import { isEdgeLabel } from "../model/relationships";

export type ValidationIssue = {
  code:
    | "UNKNOWN_LABEL"
    | "SELF_RELATIONSHIP"
    | "TYPE_MISMATCH"
    | "EXTENDS_CYCLE"
    | "REQUIRES_CYCLE";
  message: string;
  edgeId?: string;
  atomId?: string;
};

export function validatePackGraph(atoms: Atom[], edges: Edge[]): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));

  for (const edge of edges) {
    if (!isEdgeLabel(edge.label)) {
      errors.push({
        code: "UNKNOWN_LABEL",
        message: `Edge ${edge.id} has unknown label ${edge.label}`,
        edgeId: edge.id,
      });
      continue;
    }

    if (edge.sourceAtomId === edge.targetAtomId) {
      errors.push({
        code: "SELF_RELATIONSHIP",
        message: `Invalid ${edge.label} relationship: self-referential edges are not allowed`,
        edgeId: edge.id,
      });
      continue;
    }

    const source = atomById.get(edge.sourceAtomId);
    const target = atomById.get(edge.targetAtomId);
    if (!source || !target) continue;

    const typeError = validateEdgeTypeConstraint(edge.label, source.type, target.type);
    if (typeError) {
      errors.push({
        code: "TYPE_MISMATCH",
        message: typeError,
        edgeId: edge.id,
      });
    }
  }

  const extendsCycle = hasCycle(edges, "EXTENDS");
  if (extendsCycle) {
    errors.push({
      code: "EXTENDS_CYCLE",
      message: "EXTENDS graph contains a cycle",
    });
  }

  const requiresCycle = hasCycle(edges, "REQUIRES");
  if (requiresCycle) {
    errors.push({
      code: "REQUIRES_CYCLE",
      message: "REQUIRES graph contains a cycle",
    });
  }

  return { errors, warnings };
}
