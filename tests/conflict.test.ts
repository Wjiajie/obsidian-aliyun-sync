import { describe, expect, it } from "vitest";
import { createConflictPath, mergeMarkdown } from "../src/sync/conflict";

describe("conflict resolver helpers", () => {
  it("creates stable conflict names", () => {
    const date = new Date("2026-06-21T10:11:12");
    expect(createConflictPath("folder/note.md", "My Device", date)).toBe("folder/note.conflict.My-Device.20260621-101112.md");
  });

  it("returns remote when local equals base", () => {
    const result = mergeMarkdown("a", "a", "b");
    expect(result).toEqual({ content: "b", conflicted: false });
  });

  it("merges non-overlapping markdown changes with diff3", () => {
    const result = mergeMarkdown("a\nb\nc", "a\nlocal\nb\nc", "a\nb\nremote\nc");
    expect(result.conflicted).toBe(false);
    expect(result.content).toBe("a\nlocal\nb\nremote\nc");
  });

  it("keeps same-location append changes as a real diff3 conflict", () => {
    const result = mergeMarkdown("a", "a\nlocal", "a\nremote");
    expect(result.conflicted).toBe(true);
    expect(result.content).toContain("`||||||| base`");
  });

  it("emits markdown-safe conflict markers", () => {
    const result = mergeMarkdown("base", "local", "remote");
    expect(result.conflicted).toBe(true);
    expect(result.content).toContain("`<<<<<<< local`");
  });
});
