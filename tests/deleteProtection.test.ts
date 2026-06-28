import { describe, expect, it } from "vitest";
import { checkDeleteProtection, checkDownloadProtection } from "../src/sync/deleteProtection";
import type { SyncOperation } from "../src/types";

function deleteOp(path: string): SyncOperation {
  return { path, kind: "delete-local", destructive: true, reason: "test" };
}

function downloadOp(path: string): SyncOperation {
  return { path, kind: "download", destructive: false, reason: "test" };
}

function overwriteDownloadOp(path: string): SyncOperation {
  return {
    ...downloadOp(path),
    base: {
      path,
      local: { path, type: "file", size: 1, mtime: 1 },
      remote: { path, type: "file", size: 1, mtime: 1 },
      lastSuccessAt: 1,
      deviceId: "d1"
    }
  };
}

describe("delete protection", () => {
  it("passes when there are no deletes", () => {
    expect(checkDeleteProtection([], 10, { maxDeleteCount: 1, maxDeletePercentage: 1 }).ok).toBe(true);
  });

  it("blocks excessive delete counts", () => {
    const result = checkDeleteProtection([deleteOp("a"), deleteOp("b")], 10, {
      maxDeleteCount: 1,
      maxDeletePercentage: 100
    });
    expect(result.ok).toBe(false);
  });

  it("blocks excessive delete percentage", () => {
    const result = checkDeleteProtection([deleteOp("a")], 2, {
      maxDeleteCount: 10,
      maxDeletePercentage: 40
    });
    expect(result.ok).toBe(false);
  });

  it("blocks excessive downloads that would overwrite already-synced files", () => {
    const result = checkDownloadProtection([overwriteDownloadOp("a"), overwriteDownloadOp("b")], 10, true, {
      maxDownloadCount: 1,
      maxDownloadPercentage: 100
    });
    expect(result.ok).toBe(false);
  });

  it("allows many remote-only files to download as new files", () => {
    const result = checkDownloadProtection([downloadOp("a"), downloadOp("b")], 10, true, {
      maxDownloadCount: 1,
      maxDownloadPercentage: 1
    });
    expect(result.ok).toBe(true);
  });

  it("allows initial remote downloads before a sync history exists", () => {
    const result = checkDownloadProtection([overwriteDownloadOp("a"), overwriteDownloadOp("b")], 10, false, {
      maxDownloadCount: 1,
      maxDownloadPercentage: 1
    });
    expect(result.ok).toBe(true);
  });
});
