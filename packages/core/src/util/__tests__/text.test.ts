import { describe, expect, it } from "vitest";
import { nestHeadings } from "../text";

describe("nestHeadings", () => {
  it("places the shallowest heading one level below the parent", () => {
    expect(nestHeadings("## Role\n\ntext\n\n### Detail", 3)).toBe("#### Role\n\ntext\n\n##### Detail");
  });

  it("leaves already-deep headings and fenced code alone", () => {
    expect(nestHeadings("##### Deep", 3)).toBe("##### Deep");
    expect(nestHeadings("# Top\n```\n# comment\n```", 2)).toBe("### Top\n```\n# comment\n```");
  });

  it("caps at h6", () => {
    expect(nestHeadings("# A\n###### F", 5)).toBe("###### A\n###### F");
  });
});
