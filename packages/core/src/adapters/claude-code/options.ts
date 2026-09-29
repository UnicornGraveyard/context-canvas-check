import "../../util/zod-browser";
import { z } from "zod";

/** Options for the Claude Code export. All optional; defaults give the project layout. */
export const claudeCodeOptionsSchema = z.object({
  /** "project": .claude/ files for one repository. "plugin": an installable Claude Code plugin. */
  layout: z.enum(["project", "plugin"]).default("project"),
  /** Writes OpenTelemetry settings so Claude Code usage can be tied back to this blueprint. */
  telemetry: z
    .object({
      endpoint: z.string().url().max(500),
      protocol: z.enum(["grpc", "http/protobuf", "http/json"]).default("http/protobuf"),
      /** Extra OTel resource attributes, e.g. cc.blueprint.id. */
      resourceAttributes: z.record(z.string().regex(/^[A-Za-z][\w.-]{0,63}$/), z.string().max(200)).default({}),
    })
    .optional(),
  plugin: z
    .object({
      /** Plugin name: lowercase letters, digits and hyphens. Defaults to the blueprint's slug. */
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
      version: z.string().regex(/^\d+\.\d+\.\d+([-+][\w.-]+)?$/).optional(),
      /** Also write .claude-plugin/marketplace.json so the repository can be added as a marketplace. */
      marketplace: z.boolean().default(false),
      /** Attribution in plugin.json, e.g. a team or company name. Omitted when unset. */
      author: z.string().min(1).max(100).optional(),
    })
    .default({ marketplace: false }),
});

export type ClaudeCodeOptions = z.infer<typeof claudeCodeOptionsSchema>;

/** OTel resource attribute values are percent-encoded where they would break the k=v,k=v list. */
function encodeAttribute(value: string): string {
  return value.replace(/[%,=\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** Environment variables that turn on Claude Code OpenTelemetry export. */
export function telemetryEnv(telemetry: NonNullable<ClaudeCodeOptions["telemetry"]>): Record<string, string> {
  const attributes = Object.entries(telemetry.resourceAttributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${encodeAttribute(value)}`)
    .join(",");
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: telemetry.protocol,
    OTEL_EXPORTER_OTLP_ENDPOINT: telemetry.endpoint,
    ...(attributes ? { OTEL_RESOURCE_ATTRIBUTES: attributes } : {}),
  };
}
