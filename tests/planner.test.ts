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

function fileWithoutHash(path: string, size: number, mtime = 1000): SyncEntity {
  return { path, type: "file", size, mtime };
}

function folder(path: string, mtime = 1000): SyncEntity {
  return { path, type: "folder", size: 0, mtime };
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

  it("uploads the saved path when save-triggered local content changed", () => {
    const records = { "a.md": base("a.md", "base") };
    const plan = buildSyncPlan(
      [file("a.md", "local")],
      [file("a.md", "remote")],
      records,
      settings,
      {
        changedPaths: ["a.md"],
        preferLocalPaths: ["a.md"]
      }
    );

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].kind).toBe("upload");
    expect(plan.operations[0].archiveRemoteBeforeWrite).toBe(true);
    expect(plan.summary.conflicts).toBe(1);
  });

  it("scopes save-triggered plans to the changed paths", () => {
    const records = {
      "a.md": base("a.md", "base"),
      "b.md": base("b.md", "base")
    };
    const plan = buildSyncPlan(
      [file("a.md", "local"), file("b.md", "local")],
      [file("a.md", "remote"), file("b.md", "remote")],
      records,
      settings,
      {
        changedPaths: ["a.md"],
        preferLocalPaths: ["a.md"]
      }
    );

    expect(plan.operations.map((operation) => operation.path)).toEqual(["a.md"]);
    expect(plan.operations[0].kind).toBe("upload");
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

  it("does not download when remote only has a timestamp drift without a comparable hash", () => {
    const local = file("a.md", "A".repeat(40), 1000);
    const baseRemote = fileWithoutHash("a.md", 40, 1000);
    const records: Record<string, SyncBaseRecord> = {
      "a.md": {
        path: "a.md",
        local,
        remote: baseRemote,
        baseText: "base",
        lastSuccessAt: 1,
        deviceId: "d1"
      }
    };

    const plan = buildSyncPlan(
      [local],
      [fileWithoutHash("a.md", 40, 5000)],
      records,
      settings
    );

    expect(plan.operations[0].kind).toBe("adopt");
  });

  it("ignores folder timestamp drift", () => {
    const records: Record<string, SyncBaseRecord> = {
      folder: {
        path: "folder",
        local: folder("folder", 1000),
        remote: folder("folder", 1000),
        lastSuccessAt: 1,
        deviceId: "d1"
      }
    };

    const plan = buildSyncPlan(
      [folder("folder", 1000)],
      [folder("folder", 5000)],
      records,
      settings
    );

    expect(plan.operations).toHaveLength(0);
  });
});
