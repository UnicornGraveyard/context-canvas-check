import { ALL_ATOM_TYPES, CORE_OO_ATOM_TYPES, KNOWLEDGE_ATOM_TYPES, LIFECYCLE_ATOM_TYPES } from "./atom-types";

export { ALL_ATOM_TYPES, CORE_OO_ATOM_TYPES, KNOWLEDGE_ATOM_TYPES, LIFECYCLE_ATOM_TYPES };

/** Object-model relationships: inheritance, composition, dependencies, settings, context. */
export const OO_EDGE_LABELS = [
  "EXTENDS",
  "COMPOSES",
  "REQUIRES",
  "CONFIGURES",
  "RELATED",
] as const;

/** Lifecycle relationships: who works a stage, stage order, exit gates, and artifact handoffs. */
export const LIFECYCLE_EDGE_LABELS = [
  "ASSIGNED_TO",
  "NEXT",
  "GATED_BY",
  "PRODUCES",
  "CONSUMES",
] as const;

export const EDGE_LABELS = [...OO_EDGE_LABELS, ...LIFECYCLE_EDGE_LABELS] as const;

export type EdgeLabel = (typeof EDGE_LABELS)[number];

export type AtomTypeName = (typeof ALL_ATOM_TYPES)[number] | string;

export type RelationshipRule = {
  label: EdgeLabel;
  sourceTypes: readonly AtomTypeName[];
  targetTypes: readonly AtomTypeName[];
};

export type RelationshipDefinition = {
  label: EdgeLabel;
  sourceTypes: readonly AtomTypeName[];
  targetTypes: readonly AtomTypeName[];
  sourceTypeDisplay: string;
  targetTypeDisplay: string;
  rationale: string;
  constraints: readonly string[];
  requiresKnowledgeEndpoint?: boolean;
};

const RELATIONSHIP_DEFINITION_LIST: readonly RelationshipDefinition[] = [
  {
    label: "EXTENDS",
    sourceTypes: ["AGENT_CLASS"],
    targetTypes: ["AGENT_CLASS"],
    sourceTypeDisplay: "AGENT_CLASS",
    targetTypeDisplay: "AGENT_CLASS",
    rationale:
      "Inheritance specializes one agent from another, so both endpoints must be agent classes.",
    constraints: [
      "Multiple parent classes are allowed.",
      "EXTENDS graph must remain acyclic.",
    ],
  },
  {
    label: "COMPOSES",
    sourceTypes: ["AGENT_CLASS"],
    targetTypes: ["SKILL"],
    sourceTypeDisplay: "AGENT_CLASS",
    targetTypeDisplay: "SKILL",
    rationale:
      "Composition models an agent owning reusable capabilities, so it points from agent to skill.",
    constraints: [
      "Composition is directional (owner -> capability).",
    ],
  },
  {
    label: "REQUIRES",
    sourceTypes: ["SKILL"],
    targetTypes: ["SKILL"],
    sourceTypeDisplay: "SKILL",
    targetTypeDisplay: "SKILL",
    rationale:
      "Skill dependencies describe capability prerequisites, so dependencies are only between skills.",
    constraints: [
      "REQUIRES graph must remain acyclic.",
    ],
  },
  {
    label: "CONFIGURES",
    sourceTypes: ["SETTING"],
    targetTypes: ["AGENT_CLASS", "SKILL"],
    sourceTypeDisplay: "SETTING",
    targetTypeDisplay: "AGENT_CLASS|SKILL",
    rationale:
      "Settings provide runtime configuration and can only configure executable nodes (agents/skills).",
    constraints: [
      "Settings are attached, not inherited.",
    ],
  },
  {
    label: "RELATED",
    sourceTypes: ALL_ATOM_TYPES,
    targetTypes: ALL_ATOM_TYPES,
    sourceTypeDisplay: "ANY",
    targetTypeDisplay: "ANY",
    rationale:
      "RELATED is a contextual linkage for knowledge traceability and should not replace OO structural edges.",
    constraints: [
      "At least one endpoint must be a knowledge atom.",
      "Use only for context/policy linkage, not OO structure.",
    ],
    requiresKnowledgeEndpoint: true,
  },
  {
    label: "ASSIGNED_TO",
    sourceTypes: ["AGENT_CLASS"],
    targetTypes: ["STAGE"],
    sourceTypeDisplay: "AGENT_CLASS",
    targetTypeDisplay: "STAGE",
    rationale: "Assigns an agent to a lifecycle stage, as the stage's lead or as a contributor.",
    constraints: [
      "Edge metadata role is LEAD or CONTRIBUTOR (default CONTRIBUTOR).",
      "Each stage needs exactly one LEAD.",
    ],
  },
  {
    label: "NEXT",
    sourceTypes: ["STAGE"],
    targetTypes: ["STAGE"],
    sourceTypeDisplay: "STAGE",
    targetTypeDisplay: "STAGE",
    rationale: "Orders lifecycle stages; work hands off from a stage to its NEXT stage.",
    constraints: [
      "Stages form one linear chain.",
      "NEXT graph must remain acyclic; revision loops belong in gate outcomes.",
    ],
  },
  {
    label: "GATED_BY",
    sourceTypes: ["STAGE"],
    targetTypes: ["GATE"],
    sourceTypeDisplay: "STAGE",
    targetTypeDisplay: "GATE",
    rationale: "A gate decides whether a stage's output may hand off to the next stage.",
    constraints: ["Each gate belongs to exactly one stage."],
  },
  {
    label: "PRODUCES",
    sourceTypes: ["STAGE"],
    targetTypes: ["ARTIFACT"],
    sourceTypeDisplay: "STAGE",
    targetTypeDisplay: "ARTIFACT",
    rationale: "Declares an artifact a stage writes, such as requirements.md or a pull request.",
    constraints: ["Name artifacts after the file or deliverable (design.md, Pull request) so later stages can consume them."],
  },
  {
    label: "CONSUMES",
    sourceTypes: ["STAGE"],
    targetTypes: ["ARTIFACT"],
    sourceTypeDisplay: "STAGE",
    targetTypeDisplay: "ARTIFACT",
    rationale: "Declares an artifact a stage reads as input.",
    constraints: ["Artifacts should be produced by an earlier stage, or come from outside the lifecycle."],
  },
] as const;

export const RELATIONSHIP_DEFINITIONS: Record<EdgeLabel, RelationshipDefinition> =
  RELATIONSHIP_DEFINITION_LIST.reduce<Record<EdgeLabel, RelationshipDefinition>>(
    (acc, definition) => {
      acc[definition.label] = definition;
      return acc;
    },
    {} as Record<EdgeLabel, RelationshipDefinition>
  );

/**
 * Compatibility export used by schema/validation callers.
 * RELATED is represented as two directional set rules and then
 * constrained by `requiresKnowledgeEndpoint` in runtime checks.
 */
export const RELATIONSHIP_RULES: readonly RelationshipRule[] = (() => {
  const rules: RelationshipRule[] = [];

  for (const definition of RELATIONSHIP_DEFINITION_LIST) {
    if (definition.label !== "RELATED") {
      rules.push({
        label: definition.label,
        sourceTypes: definition.sourceTypes,
        targetTypes: definition.targetTypes,
      });
      continue;
    }

    rules.push({
      label: definition.label,
      sourceTypes: KNOWLEDGE_ATOM_TYPES,
      targetTypes: ALL_ATOM_TYPES,
    });
    rules.push({
      label: definition.label,
      sourceTypes: ALL_ATOM_TYPES,
      targetTypes: KNOWLEDGE_ATOM_TYPES,
    });
  }

  return rules;
})();

export const CYCLE_CHECK_LABELS = new Set<EdgeLabel>(["EXTENDS", "REQUIRES", "NEXT"]);

export function isLifecycleEdgeLabel(label: string): boolean {
  return (LIFECYCLE_EDGE_LABELS as readonly string[]).includes(label);
}

export function isEdgeLabel(label: string): label is EdgeLabel {
  return EDGE_LABELS.includes(label as EdgeLabel);
}

export function isKnowledgeAtomType(atomType: AtomTypeName): boolean {
  return KNOWLEDGE_ATOM_TYPES.includes(atomType as (typeof KNOWLEDGE_ATOM_TYPES)[number]);
}

export function getRelationshipDefinition(label: EdgeLabel): RelationshipDefinition {
  return RELATIONSHIP_DEFINITIONS[label];
}

export function describeRelationship(label: EdgeLabel): string {
  const definition = getRelationshipDefinition(label);
  const base = `${label}: ${definition.sourceTypeDisplay} -> ${definition.targetTypeDisplay}. ${definition.rationale}`;
  const constraints = definition.constraints.length > 0
    ? ` Constraints: ${definition.constraints.join(" ")}`
    : "";
  return `${base}${constraints}`;
}

function isAllowedByDefinition(
  definition: RelationshipDefinition,
  sourceType: AtomTypeName,
  targetType: AtomTypeName
): boolean {
  if (!definition.sourceTypes.includes(sourceType)) return false;
  if (!definition.targetTypes.includes(targetType)) return false;

  if (
    definition.requiresKnowledgeEndpoint &&
    !isKnowledgeAtomType(sourceType) &&
    !isKnowledgeAtomType(targetType)
  ) {
    return false;
  }

  return true;
}

/**
 * The relationship a connection between these types most likely means:
 * agent->agent EXTENDS, agent->skill COMPOSES, agent->stage ASSIGNED_TO, and
 * so on; RELATED otherwise. Callers still check it is allowed for the pair.
 */
export function preferredRelationshipLabel(sourceType: AtomTypeName, targetType: AtomTypeName): EdgeLabel {
  if (sourceType === "AGENT_CLASS" && targetType === "AGENT_CLASS") return "EXTENDS";
  if (sourceType === "AGENT_CLASS" && targetType === "SKILL") return "COMPOSES";
  if (sourceType === "SKILL" && targetType === "SKILL") return "REQUIRES";
  if (sourceType === "SETTING" && (targetType === "AGENT_CLASS" || targetType === "SKILL")) return "CONFIGURES";
  if (sourceType === "AGENT_CLASS" && targetType === "STAGE") return "ASSIGNED_TO";
  if (sourceType === "STAGE" && targetType === "STAGE") return "NEXT";
  if (sourceType === "STAGE" && targetType === "GATE") return "GATED_BY";
  if (sourceType === "STAGE" && targetType === "ARTIFACT") return "PRODUCES";
  return "RELATED";
}

export function getAllowedRelationshipLabels(
  sourceType: AtomTypeName,
  targetType: AtomTypeName
): EdgeLabel[] {
  return EDGE_LABELS.filter((label) =>
    isAllowedByDefinition(RELATIONSHIP_DEFINITIONS[label], sourceType, targetType)
  );
}

export function isRelationshipLabelAllowed(
  label: string,
  sourceType: AtomTypeName,
  targetType: AtomTypeName
): label is EdgeLabel {
  if (!isEdgeLabel(label)) return false;
  return isAllowedByDefinition(RELATIONSHIP_DEFINITIONS[label], sourceType, targetType);
}

export function validateRelationshipLabel(
  label: string,
  sourceType: AtomTypeName,
  targetType: AtomTypeName
): string | null {
  if (!isEdgeLabel(label)) {
    return `Invalid relationship label ${label}. Allowed labels: ${EDGE_LABELS.join(", ")}`;
  }

  const definition = RELATIONSHIP_DEFINITIONS[label];
  if (isAllowedByDefinition(definition, sourceType, targetType)) return null;

  const allowedPairing = `${definition.sourceTypeDisplay} -> ${definition.targetTypeDisplay}`;
  const extraConstraint = definition.requiresKnowledgeEndpoint
    ? " with at least one knowledge atom endpoint"
    : "";
  return `Invalid ${label} relationship for ${sourceType} -> ${targetType}. Allowed: ${allowedPairing}${extraConstraint}`;
}
