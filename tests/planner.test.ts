import { describe, expect, it } from "vitest";
import { buildSyncPlan } from "../src/sync/planner";
import type { SyncBaseRecord, SyncEntity } from "../src/types";

const settings = {
  enableDeleteSync: true,
  markdownMergeSizeLimitBytes: 1024,
  initialSyncConflictStrategy: "prefer-newer" as const
};

function file(path: string, hash: string, mtime = 1000): SyncEntity {
  return { path, type: "file", size: hash.length, mtime, hash };
}

function base(path: string, hash: string): SyncBaseRecord {
  const entity = file(path, hash);
  return {
    path,
    local: entity,
    remote: entity,
    baseText: "base",
    lastSuccessAt: 1,
    deviceId: "d1"
  };
}

describe("sync planner", () => {
  it("uploads local-only files on first sync", () => {
    const plan = buildSyncPlan([file("a.md", "local")], [], {}, settings);
    expect(plan.operations[0].kind).toBe("upload");
  });

  it("downloads remote-only files on first sync", () => {
    const plan = buildSyncPlan([], [file("a.md", "remote")], {}, settings);
    expect(plan.operations[0].kind).toBe("download");
  });

  it("downloads when remote changed and local did not", () => {
    const records = { "a.md": base("a.md", "base") };
    const plan = buildSyncPlan([file("a.md", "base")], [file("a.md", "remote")], records, settings);
    expect(plan.operations[0].kind).toBe("download");
  });

  it("uploads when local changed and remote did not", () => {
    const records = { "a.md": base("a.md", "base") };
    const plan = buildSyncPlan([file("a.md", "local")], [file("a.md", "base")], records, settings);
    expect(plan.operations[0].kind).toBe("upload");
  });

  it("merge-conflicts markdown when both sides changed", () => {
    const records = { "a.md": base("a.md", "base") };
    const plan = buildSyncPlan([file("a.md", "local")], [file("a.md", "remote")], records, settings);
    expect(plan.operations[0].kind).toBe("merge-markdown");
  });

  it("deletes remote when local deleted and remote unchanged", () => {
    const records = { "a.md": base("a.md", "base") };
    const plan = buildSyncPlan([], [file("a.md", "base")], records, settings);
    expect(plan.operations[0].kind).toBe("delete-remote");
  });

  it("does not create conflict copies for first-run same-path differences by default", () => {
    const plan = buildSyncPlan(
      [file("a.md", "local", 2000)],
      [file("a.md", "remote", 1000)],
      {},
      settings
    );
    expect(plan.operations[0].kind).toBe("upload");
  });

  it("adopts first-run same-path same-size files when comparable remote hash is missing", () => {
    const plan = buildSyncPlan(
      [{ path: "a.md", type: "file", size: 10, mtime: 1000, hash: "A".repeat(40) }],
      [{ path: "a.md", type: "file", size: 10, mtime: 2000 }],
      {},
      settings
    );
    expect(plan.operations[0].kind).toBe("adopt");
  });
});
