#!/usr/bin/env node
// A stand-in for the person at the keyboard. Claude Code routes its permission
// prompts here (--permission-prompt-tool mcp__approver__approve). Like most
// people, it approves: any file tool call inside the run's temporary repository
// is allowed. Anything outside that repository, or any other tool, is denied.
// Every prompt is logged, so the results show what a person would have been asked.
//
// A minimal MCP server over stdio (JSON-RPC 2.0, one message per line), with no dependencies.
import { appendFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

const workDir = resolve(process.env.WORK_DIR ?? process.cwd());
// The same directory can have two names (macOS: /var is a symlink to /private/var).
const roots = [...new Set([workDir, realpathSync(workDir)])].map((root) => root + sep);

/** The real path of a target that may not exist yet: resolve its nearest existing ancestor. */
function realTarget(path) {
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  return realpathSync(existing) + path.slice(existing.length);
}

const isInside = (target) => {
  const absolute = resolve(workDir, String(target));
  return roots.some((root) => absolute.startsWith(root) || realTarget(absolute).startsWith(root));
};
const logPath = process.env.APPROVER_LOG;
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep"]);

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");

function decide(toolName, input) {
  const target = input?.file_path ?? input?.notebook_path ?? input?.path ?? null;
  const inside = target === null ? toolName !== "Write" && toolName !== "Edit" : isInside(target);
  if (FILE_TOOLS.has(toolName) && inside) return { behavior: "allow", updatedInput: input };
  return { behavior: "deny", message: `The benchmark only approves file tools inside ${workDir}.` };
}

const TOOL = {
  name: "approve",
  description: "Benchmark harness only: answers Claude Code permission prompts. Never call this tool directly.",
  inputSchema: {
    type: "object",
    properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
    required: ["tool_name", "input"],
  },
};

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined) return; // notifications need no reply
  if (method === "initialize") {
    send({ id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "approver", version: "1.0.0" } } });
  } else if (method === "tools/list") {
    send({ id, result: { tools: [TOOL] } });
  } else if (method === "tools/call" && params?.name === "approve") {
    const { tool_name: toolName, input } = params.arguments ?? {};
    const decision = decide(toolName, input);
    if (logPath) {
      appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), tool: toolName, target: input?.file_path ?? input?.notebook_path ?? input?.path ?? null, decision: decision.behavior }) + "\n");
    }
    send({ id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
  } else if (method === "ping") {
    send({ id, result: {} });
  } else {
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
