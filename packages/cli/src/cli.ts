import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildFixPrompt, checkConfig, mightBeConfigPath, summarizeFindings } from "@context-canvas/core/config/index";
import { baselinePath, readBaseline, writeBaseline } from "./baseline";
import { discover } from "./discover";
import { formatForHook, formatText } from "./format";
import { realDir, VERSION } from "./project";

export { VERSION };

const HELP = `context-canvas-check [check] [options]
context-canvas-check mcp

Checks whether a Claude Code configuration actually applies: files that won't
load, settings that won't apply as written, and what changed since last time.

Options:
  --cwd <dir>          Folder a Claude Code session would start in (default: current folder)
  --json               Print findings as JSON
  --prompt             Print a prompt that asks a coding agent to fix the errors and warnings
  --no-user            Don't read ~/.claude (user settings, agents, skills)
  --update-baseline    Record the current configuration as the baseline for change tracking
  --strict             Exit 1 on warnings as well as errors
  --notes              Also list notes (things that are fine if intended)
  --hook <event>       Run as a Claude Code hook: session-start or post-edit

mcp                    Run as an MCP server over stdio, for Claude Code, Cursor,
                       Codex and other agents. Tools: check_config,
                       get_fix_instructions, explain_check. It only reads files.

Exit codes: 0 no errors, 1 errors (or warnings with --strict), 2 usage error.
`;

/** The prompt's closing line for someone at a terminal. */
const RECHECK = "Then run `npx context-canvas-check` to confirm.";

export type CliResult = { exitCode: number; stdout: string; stderr: string };
type Env = Record<string, string | undefined>;

type Options = { cwd?: string; json: boolean; prompt: boolean; user: boolean; updateBaseline: boolean; strict: boolean; notes: boolean; hook?: string };

function parseOptions(args: string[]): Options | string {
  const options: Options = { json: false, prompt: false, user: true, updateBaseline: false, strict: false, notes: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--prompt") options.prompt = true;
    else if (arg === "--no-user") options.user = false;
    else if (arg === "--update-baseline") options.updateBaseline = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--notes") options.notes = true;
    else if (arg === "--cwd" || arg === "--hook") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return `${arg} needs a value.`;
      if (arg === "--cwd") options.cwd = value;
      else options.hook = value;
      index += 1;
    } else return `Unknown option: ${arg}`;
  }
  if (options.hook && options.hook !== "session-start" && options.hook !== "post-edit") return `Unknown hook event: ${options.hook}. Use session-start or post-edit.`;
  if (options.json && options.prompt) return "Use --json or --prompt, not both.";
  return options;
}

function displayPath(path: string, startDir: string, home: string): string {
  const absolute = resolve(startDir, path);
  if (absolute === startDir || absolute.startsWith(startDir + sep)) return relative(startDir, absolute).split(sep).join("/");
  if (absolute.startsWith(home + sep)) return `~/${relative(home, absolute).split(sep).join("/")}`;
  return relative(startDir, absolute).split(sep).join("/");
}

export function run(argv: string[], env: Env = process.env, stdin = ""): CliResult {
  // `check` is the only command, so it is also the default: `context-canvas-check --json` works.
  const [command, ...tail] = argv;
  if (command === "help" || command === "--help" || command === "-h") return { exitCode: 0, stdout: HELP, stderr: "" };
  if (command === "--version" || command === "-v") return { exitCode: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (command === "mcp") return { exitCode: 2, stdout: "", stderr: "mcp runs as a server over stdio: add `npx -y context-canvas-check mcp` to an MCP client's configuration.\n" };
  if (command !== undefined && command !== "check" && !command.startsWith("-")) return { exitCode: 2, stdout: "", stderr: `Unknown command: ${command}\n\n${HELP}` };
  const rest = command === "check" ? tail : argv;
  const options = parseOptions(rest);
  if (typeof options === "string") return { exitCode: 2, stdout: "", stderr: `${options}\n\n${HELP}` };

  const home = realDir(env.HOME ?? homedir());
  const startDir = realDir(options.cwd ?? (options.hook ? env.CLAUDE_PROJECT_DIR : undefined) ?? process.cwd());
  const discovery = discover({ cwd: startDir, home, includeUser: options.user });

  if (options.hook === "post-edit") {
    // Runs after Claude edits a file. Exit 2 shows the problems to Claude so it can fix them.
    let target: string | undefined;
    let absolute = "";
    try {
      const filePath = (JSON.parse(stdin || "{}") as { tool_input?: { file_path?: unknown } }).tool_input?.file_path;
      if (typeof filePath === "string") {
        absolute = isAbsolute(filePath) ? filePath : resolve(startDir, filePath);
        target = displayPath(absolute, discovery.startDir, home);
      }
    } catch {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    // Both forms must look like config: the display path leaves out folder
    // names above the project, and the absolute path a settings.json outside .claude/.
    if (!target || !mightBeConfigPath(target) || !mightBeConfigPath(absolute)) return { exitCode: 0, stdout: "", stderr: "" };
    const { findings } = checkConfig(discovery.snapshot);
    const relevant = findings.filter((finding) => finding.file === target || finding.message.includes(target!));
    const text = formatForHook(relevant, `Context Canvas check: ${target} won't apply as written:`);
    return text ? { exitCode: 2, stdout: "", stderr: text } : { exitCode: 0, stdout: "", stderr: "" };
  }

  const path = baselinePath(discovery.startDir, home);
  const baseline = readBaseline(path);
  const { findings, fingerprint } = checkConfig(discovery.snapshot, { baseline });
  const notes: string[] = [];
  const updating = options.updateBaseline || options.hook === "session-start";
  if (updating) writeBaseline(path, fingerprint, discovery.startDir);
  if (!options.hook) {
    if (!baseline && !options.updateBaseline) notes.push("No baseline yet. Run `context-canvas-check --update-baseline` to start tracking changes to hooks, permissions, MCP servers and agents.");
    if (options.updateBaseline) notes.push(`Baseline recorded: ${path}`);
    if (!discovery.userScope) notes.push("User settings in ~/.claude weren't checked.");
  }

  if (options.hook === "session-start") {
    // Never blocks the session; stdout becomes context for Claude.
    return { exitCode: 0, stdout: formatForHook(findings, "Context Canvas check: some agent configuration won't apply as written. Tell the user about these before relying on it:"), stderr: "" };
  }

  const counts = summarizeFindings(findings);
  const exitCode = counts.error > 0 || (options.strict && counts.warning > 0) ? 1 : 0;
  if (options.prompt) {
    const prompt = buildFixPrompt(findings, { includeNotes: options.notes, recheck: RECHECK });
    return { exitCode, stdout: prompt || "No errors or warnings to fix.\n", stderr: "" };
  }
  if (options.json) {
    const report = {
      version: 1,
      startDir: discovery.startDir,
      userScope: discovery.userScope,
      baseline: { path, recordedAt: baseline?.recordedAt ?? null, updated: updating },
      summary: counts,
      findings,
    };
    return { exitCode, stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: "" };
  }
  return { exitCode, stdout: formatText(findings, discovery.startDir, notes, { showNotes: options.notes }), stderr: "" };
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly && process.argv[2] === "mcp") {
  // Loaded only here, so a plain check doesn't start the MCP SDK.
  const { serveMcp } = await import("./mcp");
  await serveMcp();
} else if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const stdin = argv.includes("post-edit") ? readFileSync(0, "utf8") : "";
  const result = run(argv, process.env, stdin);
  // A reader that stops early (`| head`) closes the pipe; that's not an error.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(result.exitCode);
    throw error;
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
