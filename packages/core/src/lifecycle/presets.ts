import type { GateMetadata, StageMetadata } from "../model/metadata";

/** A gate at a stage's exit, as preset data (metadata matches gateMetadataSchema). */
export type PresetGate = {
  key: string;
  title: string;
  content: string;
  metadata: GateMetadata;
};

export type PresetStage = {
  key: string;
  title: string;
  content: string;
  metadata: StageMetadata;
  gates: PresetGate[];
  /** Artifact keys the stage writes and reads. */
  produces: string[];
  consumes: string[];
};

export type PresetArtifact = {
  key: string;
  title: string;
  content: string;
};

export type LifecyclePreset = {
  id: LifecyclePresetId;
  name: string;
  description: string;
  /** Stages in NEXT order. */
  stages: PresetStage[];
  artifacts: PresetArtifact[];
};

export const LIFECYCLE_PRESET_IDS = ["AI_DLC", "SPEC_DRIVEN"] as const;
export type LifecyclePresetId = (typeof LIFECYCLE_PRESET_IDS)[number];

function approval(key: string, title: string, content: string, requiredEvidence: string[]): PresetGate {
  return {
    key,
    title,
    content,
    metadata: { gateType: "HUMAN_APPROVAL", blocking: true, approverRole: "APPROVER", requiredEvidence },
  };
}

function check(key: string, title: string, content: string, command: string, timeoutSec: number): PresetGate {
  return { key, title, content, metadata: { gateType: "CHECK", blocking: true, command, timeoutSec } };
}

function stage(
  key: string,
  title: string,
  content: string,
  metadata: Partial<StageMetadata> & Pick<StageMetadata, "kind">,
  links: { gates: PresetGate[]; produces?: string[]; consumes?: string[] }
): PresetStage {
  return {
    key,
    title,
    content,
    metadata: { entryCriteria: [], exitCriteria: [], ...metadata },
    gates: links.gates,
    produces: links.produces ?? [],
    consumes: links.consumes ?? [],
  };
}

/**
 * AI-Driven Development Lifecycle: Inception -> Construction -> Operations,
 * with a person approving each phase transition.
 */
const AI_DLC: LifecyclePreset = {
  id: "AI_DLC",
  name: "AI-DLC",
  description:
    "Inception, Construction and Operations. Agents draft and build; a person approves the plan, the change, and the release.",
  artifacts: [
    { key: "requirements", title: "requirements.md", content: "User stories with acceptance criteria for this unit of work." },
    { key: "units", title: "units-of-work.md", content: "The work split into independently deliverable units, each with scope and risks." },
    { key: "design", title: "design.md", content: "Domain model, interfaces and the approach for each unit of work." },
    { key: "pr", title: "Pull request", content: "Code, tests and docs for the unit of work, ready for review." },
    { key: "release", title: "Release record", content: "What shipped, when, how it was verified, and how to roll back." },
  ],
  stages: [
    stage(
      "inception",
      "Inception",
      "Turn the intent into user stories and units of work. Ask clarifying questions instead of assuming.",
      {
        kind: "INCEPTION",
        entryCriteria: ["A stated business intent or problem"],
        exitCriteria: ["Every user story has acceptance criteria", "Units of work are sized and ordered"],
        maxIterations: 3,
      },
      {
        gates: [
          approval("inception-approval", "Plan approval", "A person approves the stories and units of work before any code is written.", [
            "requirements.md reviewed",
            "units-of-work.md reviewed",
          ]),
        ],
        produces: ["requirements", "units"],
      }
    ),
    stage(
      "construction",
      "Construction",
      "Design each unit of work, then implement it with tests. Keep changes scoped to one unit per pull request.",
      {
        kind: "CONSTRUCTION",
        entryCriteria: ["Approved requirements.md and units-of-work.md"],
        exitCriteria: ["Tests cover the acceptance criteria", "The pull request describes design decisions"],
        maxIterations: 5,
      },
      {
        gates: [
          check("construction-tests", "Tests pass", "The test suite must pass before review.", "npm test", 900),
          approval("construction-review", "Code review", "A person reviews and approves the pull request.", ["Pull request approved"]),
        ],
        produces: ["design", "pr"],
        consumes: ["requirements", "units"],
      }
    ),
    stage(
      "operations",
      "Operations",
      "Release the change, watch it in production, and record how to roll it back.",
      {
        kind: "OPERATIONS",
        entryCriteria: ["An approved, merged pull request"],
        exitCriteria: ["Release verified in production", "Rollback steps recorded"],
      },
      {
        gates: [
          approval("operations-release", "Release approval", "A person approves the production release.", ["Release record reviewed"]),
        ],
        produces: ["release"],
        consumes: ["pr"],
      }
    ),
  ],
};

/**
 * Spec-driven development: Requirements -> Design -> Tasks -> Build -> Verify,
 * each step writing the document the next one reads.
 */
const SPEC_DRIVEN: LifecyclePreset = {
  id: "SPEC_DRIVEN",
  name: "Spec-driven",
  description:
    "Requirements, Design, Tasks, Build and Verify. Each stage writes a spec the next stage consumes: requirements.md, design.md, tasks.md.",
  artifacts: [
    { key: "requirements", title: "requirements.md", content: "User stories with acceptance criteria in EARS form (WHEN <event> THE SYSTEM SHALL <response>)." },
    { key: "design", title: "design.md", content: "Architecture, data models, interfaces, error handling and the testing approach." },
    { key: "tasks", title: "tasks.md", content: "An ordered checklist of implementation tasks, each linked to the requirements it satisfies." },
    { key: "pr", title: "Pull request", content: "The implementation of tasks.md with tests." },
    { key: "verification", title: "Verification report", content: "Each acceptance criterion with the evidence that it is met." },
  ],
  stages: [
    stage(
      "requirements",
      "Requirements",
      "Write requirements.md: user stories and testable acceptance criteria. Record open questions rather than guessing.",
      { kind: "REQUIREMENTS", exitCriteria: ["Every story has acceptance criteria", "Open questions are resolved or recorded"] },
      {
        gates: [approval("requirements-signoff", "Requirements sign-off", "A person signs off requirements.md.", ["requirements.md reviewed"])],
        produces: ["requirements"],
      }
    ),
    stage(
      "design",
      "Design",
      "Write design.md from requirements.md: components, interfaces, data and how each requirement is tested.",
      { kind: "DESIGN", entryCriteria: ["Signed-off requirements.md"], exitCriteria: ["Every requirement maps to a design element"] },
      {
        gates: [approval("design-review", "Design review", "A person reviews design.md.", ["design.md reviewed"])],
        produces: ["design"],
        consumes: ["requirements"],
      }
    ),
    stage(
      "tasks",
      "Tasks",
      "Break design.md into tasks.md: small, ordered, independently testable tasks that reference requirements.",
      { kind: "PLANNING", entryCriteria: ["Reviewed design.md"], exitCriteria: ["Every task links to at least one requirement"] },
      {
        gates: [
          {
            key: "tasks-quality",
            title: "Task plan quality",
            content: "A grader checks the task plan before building starts.",
            metadata: {
              gateType: "OUTCOME_RUBRIC",
              blocking: true,
              rubric: {
                criteria: [
                  "Every task traces to a requirement in requirements.md",
                  "Each task can be tested on its own",
                  "No task needs more than one day of work",
                ],
              },
            },
          },
        ],
        produces: ["tasks"],
        consumes: ["design"],
      }
    ),
    stage(
      "build",
      "Build",
      "Implement tasks.md in order. Tick tasks off as they land and keep tests green.",
      { kind: "CONSTRUCTION", entryCriteria: ["An approved tasks.md"], exitCriteria: ["All tasks done", "Tests pass"], maxIterations: 5 },
      {
        gates: [check("build-tests", "Build and tests", "The build and test suite must pass.", "npm test", 900)],
        produces: ["pr"],
        consumes: ["tasks"],
      }
    ),
    stage(
      "verify",
      "Verify",
      "Check every acceptance criterion against the running change and write the verification report.",
      { kind: "VERIFICATION", entryCriteria: ["A pull request that passes the build"], exitCriteria: ["Every acceptance criterion has evidence"] },
      {
        gates: [approval("acceptance", "Acceptance", "A person accepts the change against requirements.md.", ["Verification report reviewed"])],
        produces: ["verification"],
        consumes: ["pr", "requirements"],
      }
    ),
  ],
};

export const LIFECYCLE_PRESETS: Record<LifecyclePresetId, LifecyclePreset> = { AI_DLC, SPEC_DRIVEN };
