import { describe, expect, it } from "vitest";
import { parseFrontmatter, toFrontmatter } from "../frontmatter";

describe("toFrontmatter", () => {
  it("round-trips values that break unquoted YAML", () => {
    const data = {
      name: "reviewer",
      description: "Note: review `auth` # carefully, then 'report' \"findings\"",
      tricky: "`leading backtick",
      list: ["- dash", "a: b", "[bracket]"],
      maxTurns: 12,
      "user-invocable": false,
    };

    const block = toFrontmatter(data);

    expect(block.startsWith("---\n")).toBe(true);
    expect(block.endsWith("\n---")).toBe(true);
    expect(parseFrontmatter(`${block}\n\nBody`)).toEqual(data);
  });

  it("omits undefined values and empty arrays", () => {
    expect(toFrontmatter({ name: "a", model: undefined, skills: [] })).toBe("---\nname: a\n---");
  });
});

describe("parseFrontmatter", () => {
  it("returns null without a frontmatter block", () => {
    expect(parseFrontmatter("# Just markdown")).toBeNull();
  });

  it("throws on invalid YAML", () => {
    expect(() => parseFrontmatter("---\ndescription: a: b\n---\n")).toThrow();
  });
});
