// Blocks recursive deletes. Claude Code passes the tool call on stdin;
// exit code 2 blocks the call and shows stderr to Claude.
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const command = JSON.parse(input).tool_input?.command ?? "";
  if (/\brm\s+-[a-z]*r[a-z]*f?\b/.test(command)) {
    process.stderr.write("Recursive delete is blocked in this repo. Delete specific files instead.\n");
    process.exit(2);
  }
});
