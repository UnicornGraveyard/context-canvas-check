#!/usr/bin/env node
// Runs benchmark tasks with Claude Code in headless mode. Each run gets a fresh
// temporary git repository built from its fixture, so runs never share state.
//
//   node run.mjs --label baseline [--tasks T1,T2] [--runs 3] [--claude /path/to/claude]
//
// Results land in results/<label>/<task>-r<n>/: the agent's JSON output, the
// diff, a snapshot of the config files afterwards, and run metadata. Score them
// with score.mjs. The protocol is in ../protocol.md.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, index, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[index + 1]]] : pairs), [])
);
const config = JSON.parse(readFileSync(join(here, "tasks.json"), "utf8"));
const claude = args.claude ?? process.env.CLAUDE_BIN ?? "claude";
const label = args.label ?? "baseline";
const runs = Number(args.runs ?? config.runsPerTask);
const only = args.tasks ? new Set(args.tasks.split(",")) : null;
const outRoot = join(here, "results", label);

// Fixtures store config paths with a leading underscore so Claude Code does not
// load them while someone works in this repository.
const RENAMES = [["_claude", ".claude"], ["_mcp.json", ".mcp.json"], ["_CLAUDE.md", "CLAUDE.md"], ["_AGENTS.md", "AGENTS.md"]];

const git = (cwd, ...gitArgs) => spawnSync("git", gitArgs, { cwd, encoding: "utf8" });

export function materialize(fixture, dir) {
  cpSync(join(here, "fixtures", fixture), dir, { recursive: true });
  for (const [from, to] of RENAMES) {
    if (existsSync(join(dir, from))) renameSync(join(dir, from), join(dir, to));
  }
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=bench", "-c", "user.email=bench@example.com", "commit", "-q", "-m", "fixture");
}

/** This process may itself run inside Claude Code; the child must not attach to that session. */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|MCP_|OTEL_)/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

function claudeVersion() {
  return spawnSync(claude, ["--version"], { encoding: "utf8", env: childEnv() }).stdout.trim();
}

function runOnce(task, index, version) {
  const dir = join(outRoot, `${task.id}-r${index}`);
  if (existsSync(join(dir, "meta.json"))) {
    console.log(`${task.id} r${index}: already done, skipping`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), `ccbench-${task.id}-`));
  materialize(task.fixture, work);
  mkdirSync(dir, { recursive: true });
  // Claude Code asks before an agent edits its own config (.claude/**, .mcp.json), even in
  // acceptEdits mode. A headless run can't answer, so approver.mjs answers as a person would:
  // it approves file edits inside this repository and logs every prompt (amendment 1).
  const approver = {
    type: "stdio",
    command: process.execPath,
    args: [join(here, "approver.mjs")],
    env: { WORK_DIR: work, APPROVER_LOG: join(dir, "prompts.jsonl") },
  };

  const claudeArgs = [
    "-p", task.prompt,
    "--output-format", "json",
    "--permission-mode", config.claude.permissionMode,
    "--tools", config.claude.allowedTools.join(","),
    "--max-turns", String(config.claude.maxTurns),
    // The fixture's project settings apply, as in a real session; the runner's personal settings do not.
    "--setting-sources", "project,local",
    // Never start the fixture's MCP servers (one would install a package from npm); only the approver runs.
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: { approver } }),
    "--permission-prompt-tool", "mcp__approver__approve",
    "--disallowedTools", "mcp__approver__approve",
    "--no-session-persistence",
    "--max-budget-usd", "3",
  ];
  const started = Date.now();
  const result = spawnSync(claude, claudeArgs, { cwd: work, encoding: "utf8", env: childEnv(), timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const durationMs = Date.now() - started;

  git(work, "add", "-A", "-N");
  writeFileSync(join(dir, "diff.patch"), git(work, "diff", "--no-color").stdout);
  // Snapshots use the fixture naming too, so this repository never holds a live .claude/ directory.
  for (const [stored, path] of RENAMES) {
    if (existsSync(join(work, path))) cpSync(join(work, path), join(dir, "after", stored), { recursive: true });
  }
  let output = null;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    writeFileSync(join(dir, "stdout.txt"), result.stdout ?? "");
  }
  if (output) writeFileSync(join(dir, "claude.json"), JSON.stringify(output, null, 2) + "\n");
  if (result.stderr) writeFileSync(join(dir, "stderr.txt"), result.stderr);
  const meta = {
    task: task.id,
    run: index,
    fixture: task.fixture,
    prompt: task.prompt,
    claudeVersion: version,
    models: output?.modelUsage ? Object.keys(output.modelUsage) : null,
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    costUsd: output?.total_cost_usd ?? null,
    turns: output?.num_turns ?? null,
    isError: output?.is_error ?? null,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  rmSync(work, { recursive: true, force: true });
  console.log(`${task.id} r${index}: exit ${result.status}, ${meta.turns ?? "?"} turns, $${meta.costUsd ?? "?"}, ${Math.round(durationMs / 1000)}s`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = claudeVersion();
  console.log(`Claude Code ${version}; label ${label}; ${runs} run(s) per task`);
  for (const task of config.tasks) {
    if (only && !only.has(task.id)) continue;
    for (let index = 1; index <= runs; index += 1) runOnce(task, index, version);
  }
}
