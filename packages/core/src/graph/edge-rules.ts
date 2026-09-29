import { validateRelationshipLabel } from "../model/relationships";

export function validateSelfRelationship(
  sourceAtomId: string,
  targetAtomId: string,
  label: string
): string | null {
  if (sourceAtomId !== targetAtomId) return null;
  return `Invalid ${label} relationship: self-referential edges are not allowed`;
}

export function validateEdgeTypeConstraint(
  label: string,
  sourceType: string,
  targetType: string
): string | null {
  return validateRelationshipLabel(label, sourceType, targetType);
}
