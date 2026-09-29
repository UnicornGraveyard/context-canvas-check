import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHECK_DESCRIPTIONS, CHECK_TITLES, CONFIG_CHECKS, buildFixPrompt, fixableFindings, summarizeFindings } from "@context-canvas/core/config/index";
import { checkProject, realDir, VERSION } from "./project";

/**
 * The checker as an MCP server over stdio, for Claude Code, Cursor, Codex and
 * any other MCP client. Every tool reads files and returns text; nothing is
 * written (not even the drift baseline) and nothing is sent anywhere.
 */

const INSTRUCTIONS = [
  "Checks whether a Claude Code configuration actually applies, the way Claude Code loads it.",
  "Call check_config on a project to see agent files Claude Code skips, fields and settings it ignores, permission rules that don't protect what they appear to, and MCP servers that won't load.",
  "Call get_fix_instructions for the fixes, with exact line edits where the fix is mechanical. Make them, then call check_config again to confirm.",
  "The tools only read files. They change nothing and send nothing.",
].join(" ");

const RECHECK = "Then call check_config again to confirm.";

/** The ten checks in their usual order, then drift. */
const CHECK_IDS: [string, ...string[]] = [CONFIG_CHECKS[0].id, ...CONFIG_CHECKS.slice(1).map((check) => check.id), "config-drift"];
const DOCS_BY_ID = new Map(CONFIG_CHECKS.map((check) => [check.id, check.docs]));
const REPORTS_BY_ID = new Map(CONFIG_CHECKS.map((check) => [check.id, check.reports]));

const projectInput = {
  path: z
    .string()
    .optional()
    .describe("The folder a Claude Code session starts in. Default: the client's first workspace root, or else the server's working folder."),
  include_user: z.boolean().optional().describe("Also read ~/.claude: user settings, agents and skills. Default: true."),
  include_notes: z.boolean().optional().describe("Also include notes: things that apply, with a caveat. Default: false."),
};

const findingShape = z.object({
  check: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  file: z.string(),
  line: z.number().optional(),
  message: z.string(),
  detail: z.string().optional(),
  fix: z.string().optional(),
  edit: z.object({ line: z.number(), before: z.string(), after: z.string() }).optional(),
  docs: z.string(),
  reports: z.array(z.string()),
});

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export type McpServerOptions = {
  /** The home folder: ~/.claude and the drift baselines. Tests pass a temporary one. */
  home?: string;
  /** The folder used when neither the call nor the client names one. */
  cwd?: string;
};

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "context-canvas-check", title: "Context Canvas check", version: VERSION }, { instructions: INSTRUCTIONS });
  const home = options.home ?? process.env.HOME ?? homedir();

  /** The folder to check: the call's path, else the client's first workspace root, else the working folder. */
  async function projectDir(path: string | undefined): Promise<string> {
    const base = options.cwd ?? process.cwd();
    if (path) return realDir(isAbsolute(path) ? path : resolve(base, path));
    if (server.server.getClientCapabilities()?.roots) {
      try {
        const { roots } = await server.server.listRoots();
        const root = roots.find((candidate) => candidate.uri.startsWith("file://"));
        if (root) return realDir(fileURLToPath(root.uri));
      } catch {
        // The client didn't answer; use the working folder.
      }
    }
    return realDir(base);
  }

  const notAFolder = (dir: string) => ({ isError: true, content: [{ type: "text" as const, text: `No folder at ${dir}. Pass path: the folder a Claude Code session starts in.` }] });
  const isFolder = (dir: string) => existsSync(dir) && statSync(dir).isDirectory();

  server.registerTool(
    "check_config",
    {
      title: "Check Claude Code configuration",
      description:
        "Reports Claude Code configuration that won't apply as written: agent files Claude Code skips, frontmatter fields and settings it ignores, permission rules that don't match what they look like, MCP servers that won't load, and hooks, rules, servers and agents changed since the last baseline. Each finding has the file and line, why, the fix, an exact edit when the fix is mechanical, and a docs link.",
      inputSchema: projectInput,
      outputSchema: {
        project: z.string(),
        userScope: z.boolean(),
        summary: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
        findings: z.array(findingShape),
      },
      annotations: READ_ONLY,
    },
    async ({ path, include_user, include_notes }) => {
      const dir = await projectDir(path);
      if (!isFolder(dir)) return notAFolder(dir);
      const { discovery, findings } = checkProject(dir, { home, includeUser: include_user ?? true });
      const report = {
        project: discovery.startDir,
        userScope: discovery.userScope,
        summary: summarizeFindings(findings),
        findings: include_notes ? findings : findings.filter((finding) => finding.severity !== "info"),
      };
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], structuredContent: report };
    }
  );

  server.registerTool(
    "get_fix_instructions",
    {
      title: "Get fix instructions",
      description:
        "Step-by-step instructions to fix the errors and warnings check_config finds, with an exact line edit where the fix is mechanical and a note where a fix is a choice to ask about. Drift is left out: it reports a change, not a mistake.",
      inputSchema: projectInput,
      annotations: READ_ONLY,
    },
    async ({ path, include_user, include_notes }) => {
      const dir = await projectDir(path);
      if (!isFolder(dir)) return notAFolder(dir);
      const { findings } = checkProject(dir, { home, includeUser: include_user ?? true });
      const text = buildFixPrompt(findings, { includeNotes: include_notes ?? false, recheck: RECHECK });
      const skipped = findings.length - fixableFindings(findings, { includeNotes: include_notes ?? false }).length;
      return {
        content: [{ type: "text", text: text || `No errors or warnings to fix in ${dir}.${skipped ? ` ${skipped === 1 ? "1 other finding (a note or drift) needs" : `${skipped} other findings (notes or drift) need`} no fix; check_config lists them.` : ""}` }],
      };
    }
  );

  server.registerTool(
    "explain_check",
    {
      title: "Explain a check",
      description: "What a check catches, why it matters, the Claude Code docs it follows, and the public reports behind it. Without a check id, lists every check.",
      inputSchema: {
        check: z.enum(CHECK_IDS).optional().describe("A check id from a finding, such as agent-not-loaded."),
      },
      annotations: READ_ONLY,
    },
    async ({ check }) => {
      const explain = (id: string) => {
        const lines = [`${id}: ${CHECK_TITLES.get(id) ?? id}`, CHECK_DESCRIPTIONS.get(id) ?? ""];
        const docs = DOCS_BY_ID.get(id);
        if (docs) lines.push(`Docs: ${docs}`);
        const reports = REPORTS_BY_ID.get(id);
        if (reports?.length) lines.push(`Public reports: ${reports.join(", ")} (docs/research/option-c in the context-canvas-check repository)`);
        return lines.filter(Boolean).join("\n");
      };
      const text = check ? explain(check) : CHECK_IDS.map(explain).join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

/** `context-canvas-check mcp`: serves the tools over stdio until the client closes the connection. */
export async function serveMcp(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}
