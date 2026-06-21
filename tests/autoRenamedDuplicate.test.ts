import { describe, expect, it } from "vitest";
import { autoRenamedBaseName, hasAutoRenamedSibling, shouldSkipAutoRenamedPath } from "../src/lib/autoRenamedDuplicate";

describe("auto-renamed duplicate detection", () => {
  it("maps common cloud auto-rename names back to their original names", () => {
    expect(autoRenamedBaseName("00_Inbox(1)")).toBe("00_Inbox");
    expect(autoRenamedBaseName("note(2).md")).toBe("note.md");
    expect(autoRenamedBaseName("(1).obsidian")).toBe(".obsidian");
    expect(autoRenamedBaseName("Project 2026")).toBeNull();
  });

  it("skips duplicate siblings only when the original sibling exists", () => {
    const siblings = [{ name: "mental-models" }, { name: "mental-models(1)" }, { name: "Q1(archive)" }];
    expect(hasAutoRenamedSibling(siblings[1], siblings)).toBe(true);
    expect(hasAutoRenamedSibling(siblings[2], siblings)).toBe(false);
  });

  it("skips paths under auto-renamed folders when the original path exists", () => {
    const existing = new Set(["01_Projects/mental-models", ".obsidian"]);
    const exists = (path: string) => existing.has(path);

    expect(shouldSkipAutoRenamedPath("01_Projects/mental-models(2)/a.md", exists)).toBe(true);
    expect(shouldSkipAutoRenamedPath("(1).obsidian/plugins/main.js", exists)).toBe(true);
    expect(shouldSkipAutoRenamedPath("01_Projects/Q1(archive)/a.md", exists)).toBe(false);
  });
});
