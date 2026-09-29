import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { checkConfig, type ConfigBaseline, type ConfigFinding } from "@context-canvas/core/config/index";
import { baselinePath, readBaseline } from "./baseline";
import { discover, type Discovery } from "./discover";

/** The CLI's version, also reported by the MCP server. Kept equal to package.json and the plugin manifest by a test. */
export const VERSION = "0.1.0";

/** A folder's real path, so a symlinked checkout keeps one baseline. */
export function realDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export type ProjectCheck = {
  discovery: Discovery;
  findings: ConfigFinding[];
  fingerprint: ConfigBaseline;
  baseline: ConfigBaseline | null;
  baselinePath: string;
};

/**
 * Discovers and checks the configuration a session started in `dir` would
 * load, with drift against the last baseline. Reads only: recording a new
 * baseline is the caller's decision.
 */
export function checkProject(dir: string, options: { home?: string; includeUser?: boolean } = {}): ProjectCheck {
  const home = realDir(options.home ?? homedir());
  const discovery = discover({ cwd: realDir(dir), home, includeUser: options.includeUser ?? true });
  const path = baselinePath(discovery.startDir, home);
  const baseline = readBaseline(path);
  const { findings, fingerprint } = checkConfig(discovery.snapshot, { baseline });
  return { discovery, findings, fingerprint, baseline, baselinePath: path };
}
