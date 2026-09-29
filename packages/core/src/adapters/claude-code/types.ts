import type { SourceAtom as Atom, SourceEdge as Edge } from "../../model/source";
import type { Diagnostic } from "../../ir/types";
import type { FidelityReport } from "../types";

export type ExportContext = {
  atoms: Atom[];
  edges: Edge[];
};

export type ExportManifest = {
  files: Record<string, string>;
  /** One report per export target. */
  fidelity?: FidelityReport[];
  /** Adapter lint findings and cross-target path conflicts. */
  diagnostics?: Diagnostic[];
};
