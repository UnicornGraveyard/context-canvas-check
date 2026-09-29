import type { BlueprintIR, Diagnostic } from "../ir/types";
import type { ExportAdapter, FidelityReport } from "./types";
import { claudeCodeAdapter } from "./claude-code";
import { agentsMdAdapter } from "./agents-md";

/** Every export target, keyed by id. */
export const EXPORT_ADAPTERS = {
  "claude-code": claudeCodeAdapter,
  "agents-md": agentsMdAdapter,
} as const satisfies Record<string, ExportAdapter>;

export type ExportTargetId = keyof typeof EXPORT_ADAPTERS;

export const DEFAULT_EXPORT_TARGETS: readonly ExportTargetId[] = ["claude-code"];

export function isExportTargetId(value: string): value is ExportTargetId {
  return Object.hasOwn(EXPORT_ADAPTERS, value);
}

export type MultiTargetOutput = {
  files: Record<string, string>;
  fidelity: FidelityReport[];
  /** Adapter lint findings plus PATH_CONFLICT errors between targets. */
  diagnostics: Diagnostic[];
};

/**
 * Emits several targets and merges their files. When two targets write the
 * same path with different content, the earlier target wins and a
 * PATH_CONFLICT error is reported.
 */
/** Per-target options, e.g. { "claude-code": { layout: "plugin" } }. */
export type TargetOptions = Partial<Record<ExportTargetId, unknown>>;

export function emitTargets(ir: BlueprintIR, targets: readonly ExportTargetId[], options: TargetOptions = {}): MultiTargetOutput {
  return emitAdapters(ir, [...new Set(targets)].map((target) => EXPORT_ADAPTERS[target]), options);
}

/** emitTargets for adapter objects; exported for tests and custom adapter sets. */
export function emitAdapters(ir: BlueprintIR, adapters: readonly ExportAdapter[], options: Record<string, unknown> = {}): MultiTargetOutput {
  const files: Record<string, string> = {};
  const writer: Record<string, string> = {};
  const fidelity: FidelityReport[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const adapter of adapters) {
    const target = adapter.id;
    diagnostics.push(...adapter.lint(ir));
    const output = adapter.emit(ir, options[adapter.id]);
    fidelity.push(output.fidelity);

    for (const [path, content] of Object.entries(output.files)) {
      if (path in files && files[path] !== content) {
        diagnostics.push({
          code: "PATH_CONFLICT",
          severity: "error",
          path,
          adapterId: target,
          message: `${target} and ${writer[path]} both write ${path} with different content; keeping ${writer[path]}'s version.`,
        });
        continue;
      }
      files[path] = content;
      writer[path] = target;
    }
  }

  return { files, fidelity, diagnostics };
}
