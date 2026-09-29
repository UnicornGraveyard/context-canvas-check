import type { BlueprintIR, Diagnostic } from "../ir/types";

/** How faithfully a target runtime can express a blueprint feature. */
export type Support = "native" | "approximated" | "advisory" | "unsupported";

export type FidelityItem = {
  feature: string;
  irPath: string;
  level: Support;
  message: string;
};

export type FidelityReport = {
  adapterId: string;
  adapterVersion: string;
  items: FidelityItem[];
};

export type AdapterOutput = {
  /** Output file contents keyed by repository-relative path. */
  files: Record<string, string>;
  fidelity: FidelityReport;
};

/** Compiles a Blueprint IR into one agent runtime's project files. */
export type ExportAdapter = {
  id: string;
  version: string;
  /** Target-specific problems (e.g. path collisions) found before emitting. */
  lint(ir: BlueprintIR): Diagnostic[];
  /** `options` are adapter-specific and validated by the adapter. */
  emit(ir: BlueprintIR, options?: unknown): AdapterOutput;
};
