import type { BlueprintIR, Diagnostic } from "../../ir/types";

// ${VAR} or ${VAR:-default}, optionally with text around it (e.g. "Bearer ${TOKEN}").
const ENV_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}/;
// Names that usually hold credentials. Plain config such as LOG_LEVEL=debug is fine to commit.
const SECRET_ENV_KEY = /(token|secret|passw(or)?d|api_?key|private|credential|auth)/i;
const SECRET_HEADER_KEY = /(authorization|token|key|secret|cookie)/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Warns about MCP env and header values written literally. Exported files
 * are committed to repositories, so secrets belong in the environment and
 * are referenced as ${NAME}; Claude Code expands them at startup.
 */
export function lintMcpSecrets(ir: BlueprintIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const check = (servers: Record<string, unknown>, where: string) => {
    for (const [name, server] of Object.entries(servers)) {
      for (const field of ["env", "headers"] as const) {
        for (const [key, value] of Object.entries(record(record(server)[field]))) {
          if (typeof value !== "string" || value === "" || ENV_REFERENCE.test(value)) continue;
          if (!(field === "env" ? SECRET_ENV_KEY : SECRET_HEADER_KEY).test(key)) continue;
          diagnostics.push({
            code: "MCP_LITERAL_SECRET",
            severity: "warning",
            adapterId: "claude-code",
            message: `MCP server "${name}" (${where}) sets ${field}.${key} to what looks like a literal credential. Store it in an environment variable and reference it as \${VAR}; exported files are committed.`,
          });
        }
      }
    }
  };

  check(ir.settings.mcpServers, "project");
  for (const [slug, scope] of Object.entries(ir.settings.scoped.agents)) check(record(scope.mcpServers), `agent ${slug}`);
  for (const [slug, scope] of Object.entries(ir.settings.scoped.skills)) check(record(scope.mcpServers), `skill ${slug}`);
  return diagnostics;
}
