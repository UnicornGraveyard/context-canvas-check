import "../util/zod-browser";
import { z } from "zod";

export const promptSectionsSchema = z.object({
  role: z.string().max(2000).optional(),
  constraints: z.string().max(2000).optional(),
  style: z.string().max(2000).optional(),
  custom: z
    .record(z.string().max(100), z.string().max(2000))
    .optional()
    .refine((val) => !val || Object.keys(val).length <= 20, {
      message: "Custom prompt sections limited to 20 entries",
    }),
});

/** Model aliases Claude Code accepts; "inherit" uses the main conversation's model. */
export const MODEL_ALIASES = ["sonnet", "opus", "haiku", "fable", "inherit"] as const;

/** An alias, or a full model ID such as claude-opus-5 or claude-sonnet-5. */
export const modelSchema = z.union([
  z.enum(MODEL_ALIASES),
  z
    .string()
    .regex(/^claude-[a-z0-9][a-z0-9.-]{1,80}$/, "Use a model alias (sonnet, opus, haiku, fable, inherit) or a full model ID such as claude-opus-5"),
]);

export const PERMISSION_MODES = ["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan"] as const;
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const AGENT_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"] as const;
export const MEMORY_SCOPES = ["user", "project", "local"] as const;

export const agentClassMetadataSchema = z.object({
  model: modelSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  allowedTools: z.array(z.string().max(200)).max(200).optional(),
  deniedTools: z.array(z.string().max(200)).max(200).optional(),
  promptSections: promptSectionsSchema.optional(),
  /** How the agent handles permission prompts. */
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  /** Reasoning effort; availability depends on the model. */
  effort: z.enum(EFFORT_LEVELS).optional(),
  /** "worktree" runs the agent in an isolated git worktree. */
  isolation: z.literal("worktree").optional(),
  color: z.enum(AGENT_COLORS).optional(),
  /** Keep the agent running in the background. */
  background: z.boolean().optional(),
  /** Persistent memory scope across sessions. */
  memory: z.enum(MEMORY_SCOPES).optional(),
  /** First turn submitted when the agent runs as the main session agent. */
  initialPrompt: z.string().min(1).max(4000).optional(),
});

export const skillMetadataSchema = z.object({
  allowedTools: z.array(z.string().max(200)).max(200).optional(),
  model: modelSchema.optional(),
  userInvocable: z.boolean().default(true),
  argumentHint: z.string().max(500).optional(),
  /** Only people can run it (as /name); Claude never invokes it on its own. */
  disableModelInvocation: z.boolean().optional(),
  /** "fork" runs the skill in an isolated subagent. */
  context: z.literal("fork").optional(),
  /** Subagent type to run a forked skill in, e.g. Explore. */
  agent: z.string().min(1).max(100).optional(),
  /** Glob patterns of files the skill applies to. */
  paths: z.array(z.string().min(1).max(200)).max(50).optional(),
});

export const policyMetadataSchema = z.object({
  inputs: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(1000),
        required: z.boolean().default(true),
      })
    )
    .max(50)
    .default([]),
  outputs: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(1000),
      })
    )
    .max(50)
    .default([]),
  preconditions: z.array(z.string().max(1000)).max(50).default([]),
  postconditions: z.array(z.string().max(1000)).max(50).default([]),
  exportAsRule: z.boolean().default(false),
});

const permissionsSettingSchema = z.object({
  settingType: z.literal("permissions"),
  permissions: z.object({
    allow: z.array(z.string().max(200)).max(200).default([]),
    deny: z.array(z.string().max(200)).max(200).default([]),
  }),
});

const environmentSettingSchema = z.object({
  settingType: z.literal("environment"),
  environment: z
    .record(z.string().max(100), z.string().max(2000))
    .refine((val) => Object.keys(val).length <= 100, {
      message: "Environment limited to 100 entries",
    }),
});

const stringRecord = (limit: number, label: string) =>
  z
    .record(z.string().max(100), z.string().max(2000))
    .optional()
    .refine((val) => !val || Object.keys(val).length <= limit, { message: `${label} limited to ${limit} entries` });

/** A local MCP server started as a process. */
export const stdioMcpServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(500)).max(50).optional(),
  env: stringRecord(50, "MCP server env"),
});

/** A remote MCP server reached over HTTP (streamable) or SSE. */
export const remoteMcpServerSchema = z.object({
  type: z.enum(["http", "sse"]),
  url: z.string().url().max(2000),
  headers: stringRecord(50, "MCP server headers"),
});

export const mcpServerSchema = z.union([remoteMcpServerSchema, stdioMcpServerSchema]);

const mcpSettingSchema = z.object({
  settingType: z.literal("mcp"),
  mcpServers: z
    .record(z.string().max(100), mcpServerSchema)
    .refine((val) => Object.keys(val).length <= 20, {
      message: "MCP servers limited to 20 entries",
    }),
});

export const settingMetadataSchema = z.discriminatedUnion("settingType", [
  permissionsSettingSchema,
  environmentSettingSchema,
  mcpSettingSchema,
]);

/** What a stage is for; drives presets, layout and runtime defaults. */
export const STAGE_KINDS = [
  "INCEPTION",
  "REQUIREMENTS",
  "DESIGN",
  "PLANNING",
  "CONSTRUCTION",
  "VERIFICATION",
  "RELEASE",
  "OPERATIONS",
  "CUSTOM",
] as const;

const criteriaSchema = z.array(z.string().min(1).max(500)).max(20).default([]);

export const stageMetadataSchema = z.object({
  kind: z.enum(STAGE_KINDS).default("CUSTOM"),
  /** What must be true before the stage starts. */
  entryCriteria: criteriaSchema,
  /** What must be true before the stage hands off. */
  exitCriteria: criteriaSchema,
  /** How a grader judges the stage's output; maps to a hosted-run outcome. */
  outcomeRubric: z.string().min(1).max(4000).optional(),
  /** Revision attempts before the stage escalates to a person. */
  maxIterations: z.number().int().min(1).max(20).optional(),
});

/**
 * Who judges an outcome rubric: the stage lead's self-assessment ("self"), or
 * Jev, TypeSafe AI's structured-evaluation model ("jev"), which answers one
 * calibrated yes/no question per criterion.
 */
export const RUBRIC_GRADERS = ["self", "jev"] as const;
/** Default probability a criterion needs from Jev to count as met. */
export const JEV_DEFAULT_MIN_PROBABILITY = 0.7;
export const JEV_DEFAULT_MODEL = "jev-latest";

/** Membership roles that may approve a HUMAN_APPROVAL gate. */
export const GATE_APPROVER_ROLES = ["OWNER", "ADMIN", "EDITOR", "APPROVER"] as const;

const gateBase = {
  /** When false the gate reports but never stops the handoff. */
  blocking: z.boolean().default(true),
};

export const gateMetadataSchema = z.discriminatedUnion("gateType", [
  z.object({
    gateType: z.literal("HUMAN_APPROVAL"),
    ...gateBase,
    approverRole: z.enum(GATE_APPROVER_ROLES).default("APPROVER"),
    requiredEvidence: z.array(z.string().min(1).max(300)).max(20).default([]),
  }),
  z.object({
    gateType: z.literal("OUTCOME_RUBRIC"),
    ...gateBase,
    rubric: z.object({
      criteria: z.array(z.string().min(1).max(500)).min(1).max(30),
      /** Share of criteria that must pass, 0-1. Default: all. */
      passThreshold: z.number().min(0).max(1).optional(),
      /** Default "self". */
      grader: z.enum(RUBRIC_GRADERS).optional(),
      /** Jev only: probability a criterion must reach to count as met. Default 0.7. */
      minProbability: z.number().min(0.5).max(0.99).optional(),
      /** Jev only: "jev-latest" or a pinned version such as "jev-1.13.0". Pin it for reproducible gates. */
      model: z
        .string()
        .regex(/^jev-(latest|\d+\.\d+\.\d+)$/, 'Use "jev-latest" or a pinned version such as "jev-1.13.0"')
        .optional(),
    }),
  }),
  z.object({
    gateType: z.literal("CHECK"),
    ...gateBase,
    /** Shell command that must exit 0, e.g. "pnpm test". */
    command: z.string().min(1).max(500),
    timeoutSec: z.number().int().min(1).max(3600).default(300),
  }),
]);

export const ASSIGNMENT_ROLES = ["LEAD", "CONTRIBUTOR"] as const;

export const assignedToEdgeMetadataSchema = z.object({
  role: z.enum(ASSIGNMENT_ROLES).default("CONTRIBUTOR"),
});

export type StageMetadata = z.infer<typeof stageMetadataSchema>;
export type GateMetadata = z.infer<typeof gateMetadataSchema>;
export type AssignedToEdgeMetadata = z.infer<typeof assignedToEdgeMetadataSchema>;

/** The metadata schema for an edge label, or null when the label carries none. */
export function edgeMetadataSchemaFor(label: string): z.ZodType | null {
  return label === "ASSIGNED_TO" ? assignedToEdgeMetadataSchema : null;
}

export type AgentClassMetadata = z.infer<typeof agentClassMetadataSchema>;
export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export type PolicyMetadata = z.infer<typeof policyMetadataSchema>;
export type SettingMetadata = z.infer<typeof settingMetadataSchema>;

/** The metadata schema for an atom type, or null when the type has none. */
export function atomMetadataSchemaFor(type: string): z.ZodType | null {
  switch (type) {
    case "AGENT_CLASS":
      return agentClassMetadataSchema;
    case "SKILL":
      return skillMetadataSchema;
    case "POLICY":
      return policyMetadataSchema;
    case "SETTING":
      return settingMetadataSchema;
    case "STAGE":
      return stageMetadataSchema;
    case "GATE":
      return gateMetadataSchema;
    default:
      return null;
  }
}
