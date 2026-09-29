// Formats TypeScript files with Prettier after Claude edits or writes them.
// Claude Code passes the tool call on stdin; a formatting failure is reported
// to Claude on stderr but never blocks the edit.
import { spawnSync } from "node:child_process";

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const filePath = JSON.parse(input).tool_input?.file_path ?? "";
  if (!/\.(ts|tsx|mts|cts)$/.test(filePath)) return;
  const result = spawnSync("npx", ["--no-install", "prettier", "--write", filePath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(`Prettier failed on ${filePath}:\n${result.stderr || result.error?.message || ""}\n`);
  }
});
