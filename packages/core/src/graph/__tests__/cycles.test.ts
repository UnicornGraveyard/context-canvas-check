import { describe, expect, it } from "vitest";
import { hasCycle, hasPath, wouldCreateCycle } from "../cycles";

const edge = (sourceAtomId: string, targetAtomId: string, label = "EXTENDS") => ({ sourceAtomId, targetAtomId, label });

describe("hasCycle", () => {
  it("finds a cycle only among edges with the given label", () => {
    const edges = [edge("a", "b"), edge("b", "a", "REQUIRES")];
    expect(hasCycle(edges, "EXTENDS")).toBe(false);
    expect(hasCycle([...edges, edge("b", "a")], "EXTENDS")).toBe(true);
  });
});

describe("hasPath", () => {
  it("follows directed edges transitively", () => {
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(hasPath(edges, "a", "c")).toBe(true);
    expect(hasPath(edges, "c", "a")).toBe(false);
  });

  it("treats a node as reaching itself", () => {
    expect(hasPath([], "a", "a")).toBe(true);
  });

  it("terminates on existing cycles", () => {
    expect(hasPath([edge("a", "b"), edge("b", "a")], "a", "z")).toBe(false);
  });
});

describe("wouldCreateCycle", () => {
  it("detects that closing a chain creates a cycle", () => {
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(edges, "c", "a", "EXTENDS")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "c", "EXTENDS")).toBe(false);
    expect(wouldCreateCycle(edges, "c", "a", "REQUIRES")).toBe(false);
  });
});
