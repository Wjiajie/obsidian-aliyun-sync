import { describe, expect, it } from "vitest";
import { formatSyncProgress, operationProgressLabel } from "../src/sync/progress";
import type { SyncOperation } from "../src/types";

describe("sync progress", () => {
  it("formats phase progress with counts", () => {
    expect(formatSyncProgress({ phase: "scan", message: "扫描本地和云端文件", current: 2, total: 5 }))
      .toBe("正在同步 2/5 - 扫描本地和云端文件");
  });

  it("formats operation progress with a shortened path", () => {
    const text = formatSyncProgress({
      phase: "execute",
      message: "上传",
      current: 3,
      total: 10,
      path: "folder/subfolder/very-long-note-name-that-should-be-shortened.md"
    });

    expect(text).toContain("正在同步 3/10 - 上传: ...");
    expect(text.length).toBeLessThan(80);
  });

  it("uses human labels for operations", () => {
    const operation: SyncOperation = {
      kind: "merge-markdown",
      path: "a.md",
      reason: "changed on both sides",
      destructive: false
    };

    expect(operationProgressLabel(operation)).toBe("合并 Markdown");
  });
});
