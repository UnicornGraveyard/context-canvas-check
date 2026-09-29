import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ConfigBaseline } from "@context-canvas/core/config/index";

/**
 * The last-seen baseline for a project lives in the user's home folder, not
 * the repository: it includes user-scope settings, and it changes every time
 * it's updated. It holds names, rules and hashes, never secret values.
 */

export function baselinePath(startDir: string, home = homedir()): string {
  const id = createHash("sha256").update(startDir).digest("hex").slice(0, 16);
  return join(home, ".context-canvas", "baselines", `${id}.json`);
}

export function readBaseline(path: string): ConfigBaseline | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ConfigBaseline & { project?: string };
    return parsed.version === 1 && parsed.entries ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBaseline(path: string, baseline: ConfigBaseline, startDir: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ project: startDir, ...baseline }, null, 2)}\n`);
}
