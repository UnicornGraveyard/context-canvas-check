import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../../../ir/compile";
import { claudeCodeAdapter } from "../index";
import { GATE_SCRIPT_PATH, LIFECYCLE_JSON_PATH } from "../generators/lifecycle";

// Runs the generated gate.mjs against a local stand-in for the TypeSafe API
// (POST /v1/systemone), so the Jev grading path is tested end to end.

const atom = (id: string, type: string, title: string, metadata: unknown = null) => ({ id, type, title, content: `${title}.`, metadata });

function blueprint() {
  const atoms = [
    atom("builder", "AGENT_CLASS", "Builder"),
    atom("build", "STAGE", "Build", { kind: "CONSTRUCTION", maxIterations: 5 }),
    atom("report", "ARTIFACT", "report.md"),
    atom("spec", "ARTIFACT", "spec.md"),
    atom("quality", "GATE", "Quality", {
      gateType: "OUTCOME_RUBRIC",
      rubric: { criteria: ["Every task has a test", "No TODOs remain"], grader: "jev", minProbability: 0.7, model: "jev-1.13.0" },
    }),
  ];
  const edges = [
    { id: "e1", sourceAtomId: "builder", targetAtomId: "build", label: "ASSIGNED_TO", metadata: { role: "LEAD" } },
    { id: "e2", sourceAtomId: "build", targetAtomId: "quality", label: "GATED_BY" },
    { id: "e3", sourceAtomId: "build", targetAtomId: "report", label: "PRODUCES" },
    { id: "e4", sourceAtomId: "build", targetAtomId: "spec", label: "CONSUMES" },
  ];
  return compile({ atoms, edges }, { name: "Jev graded" }).ir;
}

type Recorded = {
  authorization: string | undefined;
  body: {
    state: { producedFiles: Record<string, string>; inputFiles: Record<string, string>; evidence: string };
    model: string;
    questions: Record<string, { type: string; instructions: string }>;
  };
};

describe("rubric gates graded by Jev", () => {
  const { files, fidelity } = claudeCodeAdapter.emit(blueprint());
  let root: string;
  let server: Server;
  let baseUrl: string;
  let reply: { status: number; answers: Record<string, number> } = { status: 200, answers: {} };
  const requests: Recorded[] = [];

  const readBody = (request: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      request.on("data", (chunk) => (data += chunk));
      request.on("end", () => resolve(data));
    });

  const run = (env: Record<string, string | undefined>) =>
    new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [join(root, GATE_SCRIPT_PATH), "stop", "builder"], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, TYPESAFE_API_KEY: undefined, TYPESAFE_BASE_URL: undefined, ...env },
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.stdin.end("{}");
      child.on("close", (status) => resolve({ status, stderr }));
    });

  const evidence = () => JSON.parse(readFileSync(join(root, ".context-canvas/evidence/quality.json"), "utf8"));

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "cc-jev-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    writeFileSync(join(root, "report.md"), "# Report\nEvery task has a test. No TODOs.\n");
    writeFileSync(join(root, "spec.md"), "# Spec\nTasks: A, B.\n");
    server = createServer(async (request, response) => {
      const body = JSON.parse(await readBody(request));
      requests.push({ authorization: request.headers.authorization, body });
      if (reply.status !== 200) {
        response.writeHead(reply.status).end("{}");
        return;
      }
      const answers = Object.fromEntries(Object.entries(reply.answers).map(([id, noul]) => [id, { type: "noul", noul }]));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 0 } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the grader settings into lifecycle.json and reports the grader in the fidelity report", () => {
    const lifecycle = JSON.parse(files[LIFECYCLE_JSON_PATH]);
    expect(lifecycle.stages[0].gates[0]).toMatchObject({ type: "OUTCOME_RUBRIC", grader: "jev", model: "jev-1.13.0", minProbability: 0.7 });
    expect(fidelity.items.find((item) => item.feature === "Rubric gates graded by Jev")).toMatchObject({ level: "native" });
    expect(files["CLAUDE.md"]).toContain("rubric graded by Jev");
  });

  it("asks one yes/no question per criterion with the stage's files as state, and blocks on unmet criteria", async () => {
    reply = { status: 200, answers: { criterion_0: 0.93, criterion_1: 0.41 } };
    const result = await run({ TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: baseUrl });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Jev judged 1 of 2 criteria met");
    expect(result.stderr).toContain("- No TODOs remain (p=0.41)");

    const request = requests.at(-1)!;
    expect(request.authorization).toBe("Bearer sk-test");
    expect(request.body.model).toBe("jev-1.13.0");
    expect(Object.values(request.body.questions).map((question) => question.type)).toEqual(["noul", "noul"]);
    expect(request.body.questions.criterion_1.instructions).toContain("No TODOs remain");
    expect(request.body.state.producedFiles["report.md"]).toContain("Every task has a test");
    expect(request.body.state.inputFiles["spec.md"]).toContain("Tasks: A, B.");

    expect(evidence()).toMatchObject({
      passed: false,
      met: 1,
      grader: "jev",
      model: "jev-1.13.0",
      results: [
        { criterion: "Every task has a test", probability: 0.93, met: true },
        { criterion: "No TODOs remain", probability: 0.41, met: false },
      ],
    });
  });

  it("passes when every criterion clears the minimum probability", async () => {
    reply = { status: 200, answers: { criterion_0: 0.95, criterion_1: 0.88 } };
    const result = await run({ TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: baseUrl });
    expect(result.status).toBe(0);
    expect(evidence()).toMatchObject({ passed: true, met: 2, grader: "jev" });
  });

  it("falls back to the self-assessed checklist without a key or when the API fails, and records why", async () => {
    // A passed gate is not graded again; start from an unpassed one.
    rmSync(join(root, ".context-canvas/evidence/quality.json"));
    const noKey = await run({ TYPESAFE_BASE_URL: baseUrl });
    expect(noKey.stderr).toContain("TYPESAFE_API_KEY is not set; using the self-assessed checklist instead.");
    expect(noKey.status).toBe(2);
    expect(evidence()).toMatchObject({ grader: "self", note: "TYPESAFE_API_KEY is not set", passed: false });

    reply = { status: 529, answers: {} };
    const overloaded = await run({ TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: baseUrl });
    expect(overloaded.stderr).toContain("Jev returned HTTP 529");
    expect(evidence()).toMatchObject({ grader: "self", note: "Jev returned HTTP 529" });

    // The checklist still works as before.
    writeFileSync(
      join(root, ".context-canvas/evidence/quality.md"),
      "- [x] Every task has a test (tests/*.spec.ts)\n- [x] No TODOs remain (grep clean)\n"
    );
    expect((await run({})).status).toBe(0);
    expect(evidence()).toMatchObject({ grader: "self", passed: true });
  });
});
