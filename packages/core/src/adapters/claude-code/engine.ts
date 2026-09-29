import type { SourceAtom as Atom, SourceEdge as Edge } from "../../model/source";
import { compile } from "../../ir/compile";
import { DEFAULT_EXPORT_TARGETS, emitTargets, type ExportTargetId } from "../registry";
import type { ExportManifest } from "./types";

export type ExportBuildOptions = {
  packName?: string;
  packDescription?: string;
  /** Accepted for compatibility; not read by the exporter. */
  exportConfig?: Record<string, unknown> | null;
  /** Export targets to emit; defaults to Claude Code only. */
  targets?: readonly ExportTargetId[];
};

/** Compiles atoms and edges to the Blueprint IR and emits the requested targets. */
export function buildExportManifest(
  atoms: Atom[],
  edges: Edge[],
  options?: ExportBuildOptions
): ExportManifest {
  const { ir } = compile(
    { atoms, edges },
    { name: options?.packName, description: options?.packDescription }
  );
  return emitTargets(ir, options?.targets ?? DEFAULT_EXPORT_TARGETS);
}
