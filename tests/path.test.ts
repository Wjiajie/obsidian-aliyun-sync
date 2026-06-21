import { describe, expect, it } from "vitest";
import { joinRemotePath, matchesIgnore, normalizeVaultPath } from "../src/lib/path";

describe("path helpers", () => {
  it("normalizes vault paths", () => {
    expect(normalizeVaultPath("\\foo\\bar.md")).toBe("foo/bar.md");
    expect(normalizeVaultPath("/foo/./bar.md")).toBe("foo/bar.md");
  });

  it("rejects traversal", () => {
    expect(() => normalizeVaultPath("../secret.md")).toThrow(/traversal/);
  });

  it("joins remote root and relative path", () => {
    expect(joinRemotePath("/Apps/ObsidianSync", "foo/bar.md")).toBe("/Apps/ObsidianSync/foo/bar.md");
  });

  it("matches ignore patterns", () => {
    expect(matchesIgnore(".trash/a.md", [".trash/**"])).toBe(true);
    expect(matchesIgnore("notes/a.md", [".trash/**"])).toBe(false);
  });
});
