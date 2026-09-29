// Starts the built MCP server over stdio, the way an MCP client does, and
// checks that it lists its tools and finds a broken agent. Run after build.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const project = mkdtempSync(join(tmpdir(), "cc-mcp-smoke-"));
mkdirSync(join(project, ".claude/agents"), { recursive: true });
writeFileSync(join(project, ".claude/agents/tester.md"), "---\nname: tester\ndescription: Tests.\nhooks: []\n---\nTest.\n");

const client = new Client({ name: "mcp-smoke", version: "0.0.0" });
try {
  const bundle = fileURLToPath(new URL("../dist/context-canvas.mjs", import.meta.url));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bundle, "mcp"], env: { ...process.env, HOME: project } }));
  const names = (await client.listTools()).tools.map((tool) => tool.name).join(", ");
  if (names !== "check_config, get_fix_instructions, explain_check") throw new Error(`Unexpected tools: ${names}`);
  const result = await client.callTool({ name: "check_config", arguments: { path: project, include_user: false } });
  const summary = result.structuredContent?.summary;
  if (summary?.error !== 1) throw new Error(`Expected 1 error, got ${JSON.stringify(summary)}`);
  console.log(`MCP server answers over stdio: ${names}. check_config found the broken agent.`);
} finally {
  await client.close();
  rmSync(project, { recursive: true, force: true });
}
