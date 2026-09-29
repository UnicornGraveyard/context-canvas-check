// Domain kernel: the atom/edge model, graph validation and the export
// adapters. Pure and deterministic; no database, network or framework imports.
export * from "./model/atom-types";
export * from "./model/source";
export * from "./model/relationships";
export * from "./model/metadata";
export * from "./graph/edge-rules";
export * from "./graph/cycles";
export * from "./graph/validate";
export * from "./graph/compliance";
export * from "./graph/auto-fix";
export * from "./graph/build-gate";
export * from "./graph/lifecycle";
export * from "./lifecycle/presets";
export * from "./policy/org-policy";
export * from "./import/claude-project";
export * from "./util/slug";
export * from "./ir/types";
export * from "./ir/compile";
export * from "./ir/canonical";
export * from "./adapters/types";
export { claudeCodeAdapter, CLAUDE_CODE_ADAPTER_ID } from "./adapters/claude-code";
export { claudeCodeOptionsSchema, type ClaudeCodeOptions } from "./adapters/claude-code/options";
export { agentsMdAdapter, AGENTS_MD_ADAPTER_ID } from "./adapters/agents-md";
export * from "./adapters/registry";
export { buildExportManifest, type ExportBuildOptions } from "./adapters/claude-code/engine";
export { parseFrontmatter, toFrontmatter } from "./adapters/claude-code/frontmatter";
export { isKnownClaudeCodeTool, lintClaudeCodeTools } from "./adapters/claude-code/tools";
export * from "./config";
