import type { GateMetadata, StageMetadata } from "../model/metadata";
// Blueprint IR: the canonical, runtime-agnostic form of a blueprint. The
// compiler builds it from atoms and edges; every export adapter and (from
// Phase 3) the hosted runtime consume it. Entities keep their source atom id
// for provenance and their raw metadata so adapters can render exactly.

export const IR_VERSION = 1 as const;

/**
 * Version of the compiler (source graph -> IR). Bump when the same source
 * would compile to a different IR, so stored blueprint versions record which
 * compiler produced them.
 */
export const COMPILER_VERSION = "1.1.0";

export type Diagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  atomId?: string;
  edgeId?: string;
  path?: string;
  adapterId?: string;
};

/** Metadata exactly as stored on the source atom; non-objects become null. */
export type RawMetadata = Record<string, unknown> | null;

export type IRPromptSections = {
  role?: string;
  constraints?: string;
  style?: string;
  custom?: Record<string, string>;
};

/** An agent's configuration after merging its EXTENDS ancestors. */
export type IRAgentConfig = {
  model?: string;
  maxTurns?: number;
  allowedTools: string[];
  deniedTools: string[];
  promptSections: IRPromptSections;
  permissionMode?: string;
  effort?: string;
  isolation?: string;
  color?: string;
  background?: boolean;
  memory?: string;
  initialPrompt?: string;
  /** Merged prompt sections as markdown, followed by the agent's own content. */
  prompt: string;
};

export type IRAncestor = {
  id: string;
  title: string;
  slug: string;
};

export type IRAgent = {
  id: string;
  title: string;
  slug: string;
  content: string;
  metadata: RawMetadata;
  /** EXTENDS ancestors in merge order (parents sorted by title, then id). */
  ancestors: IRAncestor[];
  /** Null when the agent's metadata could not be merged; see configError. */
  config: IRAgentConfig | null;
  configError?: string;
  /** COMPOSES skills plus their transitive REQUIRES, in resolution order. */
  skillIds: string[];
  /** COMPOSES edges leaving this agent, valid or not. */
  directComposeCount: number;
};

export type IRSkill = {
  id: string;
  title: string;
  slug: string;
  content: string;
  metadata: RawMetadata;
};

/** A POLICY atom exported as a rule (metadata.exportAsRule === true). */
export type IRRule = IRSkill;

/** Knowledge atoms (FACT, DECISION, TASK, ARTIFACT, SNIPPET, non-rule POLICY). */
export type IRKnowledge = {
  id: string;
  type: string;
  title: string;
  content: string;
};

export type IRPermissions = {
  allow: string[];
  deny: string[];
};

export type IRSettingsScope = {
  permissions?: IRPermissions;
  env?: Record<string, string>;
  mcpServers?: Record<string, unknown>;
  /** Titles of the SETTING atoms that contributed. */
  sources?: string[];
};

export type IRSettings = {
  /** Every SETTING atom's permissions and environment, merged in atom order. */
  global: {
    permissions?: IRPermissions;
    env?: Record<string, string>;
  };
  /** MCP servers by name from every MCP SETTING atom, merged in atom order. */
  mcpServers: Record<string, unknown>;
  /** CONFIGURES attachments keyed by target slug. */
  scoped: {
    agents: Record<string, IRSettingsScope>;
    skills: Record<string, IRSettingsScope>;
  };
  /** Any CONFIGURES edge targets an agent or skill (even from a non-setting). */
  hasAgentOrSkillConfigures: boolean;
};

export type IRGate = {
  id: string;
  title: string;
  slug: string;
  content: string;
  /** Parsed gate settings; null when invalid (the build gate reports it). */
  config: GateMetadata | null;
  configError?: string;
};

export type IRStage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  /** 1-based position along the NEXT chain. */
  order: number;
  kind: StageMetadata["kind"];
  entryCriteria: string[];
  exitCriteria: string[];
  outcomeRubric?: string;
  maxIterations?: number;
  /** Slug of the LEAD agent, or null when the stage has none. */
  lead: string | null;
  /** Slugs of CONTRIBUTOR agents, sorted. */
  contributors: string[];
  gates: IRGate[];
  /** Slugs of artifacts this stage writes and reads. */
  produces: string[];
  consumes: string[];
};

export type IRArtifact = {
  id: string;
  title: string;
  slug: string;
  content: string;
};

/** Stages in order with their people, gates and artifact handoffs. */
export type IRLifecycle = {
  stages: IRStage[];
  /** Artifacts referenced by PRODUCES or CONSUMES, by title. */
  artifacts: IRArtifact[];
  /** False when stages are not one chain; stages are then ordered by title. */
  linear: boolean;
};

export type BlueprintIR = {
  irVersion: typeof IR_VERSION;
  blueprint: {
    name?: string;
    description?: string;
  };
  agents: IRAgent[];
  skills: IRSkill[];
  rules: IRRule[];
  knowledge: IRKnowledge[];
  settings: IRSettings;
  /** Null when the blueprint has no stages. */
  lifecycle: IRLifecycle | null;
};
