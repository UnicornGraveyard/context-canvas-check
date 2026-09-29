import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../cli";
import { createMcpServer } from "../mcp";
import { VERSION } from "../project";
import { brokenRepo, write, writeFixture } from "./fixtures";

// The MCP server, driven by a real MCP client over an in-memory transport.

const temps: string[] = [];
const tempDir = (label: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `cc-mcp-${label}-`)));
  temps.push(dir);
  return dir;
};
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function connect(options: { home: string; cwd?: string; roots?: string[] }) {
  const server = createMcpServer({ home: options.home, cwd: options.cwd });
  const client = new Client({ name: "test-client", version: "0.0.0" }, options.roots ? { capabilities: { roots: {} } } : {});
  if (options.roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: options.roots!.map((dir) => ({ uri: pathToFileURL(dir).href })) }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

type Text = { content: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: { findings: Array<{ check: string; severity: string; file: string; edit?: unknown }> } };
const textOf = (result: unknown) => (result as Text).content.map((part) => part.text).join("\n");

describe("the MCP server", () => {
  const root = tempDir("broken");
  const home = tempDir("home");
  writeFixture(root, brokenRepo);
  write(home, brokenRepo.home);
  const app = join(root, brokenRepo.start);

  it("offers three read-only tools and says what they're for", async () => {
    const client = await connect({ home });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["check_config", "get_fix_instructions", "explain_check"]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.openWorldHint === false)).toBe(true);
    expect(client.getServerVersion()).toMatchObject({ name: "context-canvas-check", version: VERSION });
    expect(client.getInstructions()).toContain("They change nothing and send nothing.");
    await client.close();
  });

  it("check_config finds what the CLI finds, with exact edits", async () => {
    const client = await connect({ home });
    const result = (await client.callTool({ name: "check_config", arguments: { path: app, include_notes: true } })) as Text;
    const cli = JSON.parse(run(["check", "--cwd", app, "--json"], { HOME: home }).stdout) as { findings: unknown[] };
    expect(result.structuredContent?.findings).toEqual(cli.findings);
    expect(JSON.parse(textOf(result)).findings).toEqual(cli.findings);
    const tester = result.structuredContent?.findings.find((finding) => finding.file === ".claude/agents/tester.md");
    expect(tester).toMatchObject({ check: "agent-not-loaded", edit: { line: 4, before: "hooks: []", after: "" } });
    // Notes are left out unless asked for.
    const plain = (await client.callTool({ name: "check_config", arguments: { path: app } })) as Text;
    expect(plain.structuredContent?.findings.every((finding) => finding.severity !== "info")).toBe(true);
    await client.close();
  });

  it("get_fix_instructions returns the fix prompt, ending with a recheck", async () => {
    const client = await connect({ home });
    const text = textOf(await client.callTool({ name: "get_fix_instructions", arguments: { path: app, include_user: false } }));
    expect(text).toContain("Fix these Claude Code configuration problems in this project.");
    expect(text).toContain("Edit: on line 4, replace `allowed-tools: Read, Grep` with `tools: Read, Grep`.");
    expect(text).not.toContain("~/.claude");
    expect(text.trimEnd().endsWith("Then call check_config again to confirm.")).toBe(true);
    await client.close();
  });

  it("checks the client's workspace root when no path is given", async () => {
    const client = await connect({ home, cwd: tempDir("elsewhere"), roots: [app] });
    const result = (await client.callTool({ name: "check_config", arguments: {} })) as Text & { structuredContent: { project: string } };
    expect(result.structuredContent.project).toBe(app);
    await client.close();
  });

  it("reports a folder that isn't there as an error", async () => {
    const client = await connect({ home });
    const result = (await client.callTool({ name: "check_config", arguments: { path: join(root, "missing") } })) as Text;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No folder at");
    await client.close();
  });

  it("explain_check describes one check, or lists them all", async () => {
    const client = await connect({ home });
    const one = textOf(await client.callTool({ name: "explain_check", arguments: { check: "single-slash-path" } }));
    expect(one).toContain("single-slash-path: Rule path with one leading slash isn't absolute");
    expect(one).toContain("Docs: https://code.claude.com/docs/en/permissions#read-and-edit");
    expect(one).toContain("Public reports: R39");
    const all = textOf(await client.callTool({ name: "explain_check", arguments: {} }));
    expect(all.split("\n\n")).toHaveLength(11);
    await client.close();
  });

  it("writes nothing, not even a drift baseline", async () => {
    const fresh = tempDir("fresh-home");
    const client = await connect({ home: fresh });
    await client.callTool({ name: "check_config", arguments: { path: app } });
    await client.callTool({ name: "get_fix_instructions", arguments: { path: app } });
    expect(existsSync(join(fresh, ".context-canvas"))).toBe(false);
    await client.close();
  });
});

describe("the CLI", () => {
  const root = tempDir("prompt");
  const home = tempDir("home");
  writeFixture(root, brokenRepo);
  const app = join(root, brokenRepo.start);

  it("prints a fix prompt with --prompt, and keeps the exit code", () => {
    const result = run(["check", "--cwd", app, "--prompt", "--no-user"], { HOME: home });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("1. Error in `.claude/agents/tester.md`, line 4");
    expect(result.stdout).toContain("   Edit: delete line 4, `hooks: []`.");
    expect(result.stdout.trimEnd().endsWith("Then run `npx context-canvas-check` to confirm.")).toBe(true);
  });

  it("rejects --json with --prompt, and explains mcp", () => {
    expect(run(["check", "--cwd", app, "--json", "--prompt"], { HOME: home }).exitCode).toBe(2);
    expect(run(["mcp"], { HOME: home }).stderr).toContain("npx -y context-canvas-check mcp");
  });

  it("reports one version everywhere", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as { version: string };
    const plugin = JSON.parse(readFileSync(join(__dirname, "../../plugin/.claude-plugin/plugin.json"), "utf8")) as { version: string };
    expect([pkg.version, plugin.version]).toEqual([VERSION, VERSION]);
  });
});
