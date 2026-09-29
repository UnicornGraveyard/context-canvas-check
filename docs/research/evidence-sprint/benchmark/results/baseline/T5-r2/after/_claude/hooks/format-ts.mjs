// Formats TypeScript files with Prettier after Claude edits or writes them.
// Claude Code passes the tool call on stdin; formatting failures are reported
// on stderr but never block the edit.
import { execFileSync } from "node:child_process";

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const filePath = JSON.parse(input).tool_input?.file_path ?? "";
  if (!/\.(ts|tsx|mts|cts)$/.test(filePath)) return;
  try {
    execFileSync("npx", ["--yes", "prettier", "--write", filePath], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    process.stderr.write(`Prettier failed on ${filePath}: ${err.stderr?.toString() ?? err.message}\n`);
  }
});
