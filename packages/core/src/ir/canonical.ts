import type { BlueprintIR } from "./types";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) sorted[key] = sortKeys(child);
    }
    return sorted;
  }
  return value;
}

/** JSON with object keys sorted at every depth and undefined values dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * SHA-256 (hex) of the IR's canonical JSON. Equal IRs hash equally regardless
 * of key order, which makes blueprint versions and exports verifiable. Uses Web
 * Crypto, so it runs on the server and in the browser demo.
 */
export async function hashIR(ir: BlueprintIR): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(ir));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
