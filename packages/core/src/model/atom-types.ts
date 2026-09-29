// The single source of truth for atom types. The Prisma `AtomType` enum must
// contain every value here; its extra INTERFACE value is unused and hidden.

export const CORE_OO_ATOM_TYPES = [
  "AGENT_CLASS",
  "SKILL",
  "SETTING",
] as const;

/** Lifecycle structure: stages in order, and the gates at their exits. */
export const LIFECYCLE_ATOM_TYPES = [
  "STAGE",
  "GATE",
] as const;

export const KNOWLEDGE_ATOM_TYPES = [
  "FACT",
  "DECISION",
  "TASK",
  "ARTIFACT",
  "POLICY",
  "SNIPPET",
] as const;

/** Relationship-schema order: OO types first. */
export const ALL_ATOM_TYPES = [
  ...CORE_OO_ATOM_TYPES,
  ...LIFECYCLE_ATOM_TYPES,
  ...KNOWLEDGE_ATOM_TYPES,
] as const;

/** Types users can create, in UI order: knowledge types first. */
export const ATOM_TYPES = [
  ...KNOWLEDGE_ATOM_TYPES,
  ...CORE_OO_ATOM_TYPES,
  ...LIFECYCLE_ATOM_TYPES,
] as const;

export type AtomTypeValue = (typeof ATOM_TYPES)[number];
