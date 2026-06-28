import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncExecutor } from "../src/sync/executor";
import { SyncJournal } from "../src/sync/journal";
import type { AliyunSyncSettings, LocalAdapter, RemoteAdapter, SyncEntity, SyncPlan } from "../src/types";

const settings = {
  deviceId: "device-1",
  deviceName: "Device",
  maxParallelTransfers: 3,
  enableDeleteSync: true,
  maxDeleteCount: 20,
  maxDeletePercentage: 30
} as AliyunSyncSettings;

function entity(path: string): SyncEntity {
  return { path, type: "file", size: 1, mtime: 1, hash: path };
}

function plan(paths: string[]): SyncPlan {
  return {
    operations: paths.map((path) => ({
      kind: "upload",
      path,
      reason: "test",
      destructive: false,
      local: entity(path)
    })),
    summary: {
      upload: paths.length,
      download: 0,
      deleteLocal: 0,
      deleteRemote: 0,
      conflicts: 0,
      skipped: 0
    }
  };
}

describe("sync executor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs upload and download operations with configured parallelism", async () => {
    let active = 0;
    let maxActive = 0;
    const local: LocalAdapter = {
      list: async () => [],
      read: async () => new ArrayBuffer(1),
      write: async (path) => entity(path),
      delete: async () => undefined,
      mkdir: async () => undefined
    };
    const remote: RemoteAdapter = {
      kind: "aliyun-drive",
      authenticate: async () => undefined,
      refreshAuthIfNeeded: async () => undefined,
      stat: async () => null,
      list: async () => [],
      read: async () => new ArrayBuffer(1),
      write: async (path) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active--;
        return { ...entity(path), remoteId: path };
      },
      mkdir: async (path) => ({ ...entity(path), type: "folder", remoteId: path }),
      delete: async () => undefined,
      move: async () => undefined,
      checkConnectivity: async () => ({ ok: true, message: "ok" })
    };

    const executor = new SyncExecutor(local, remote, SyncJournal.empty("device-1"), () => settings);
    const result = await executor.execute(plan(["a.md", "b.md", "c.md", "d.md", "e.md"]));

    expect(result.applied).toBe(5);
    expect(maxActive).toBe(3);
  });

  it("skips a transfer after retryable failures instead of failing the whole sync", async () => {
    vi.useFakeTimers();
    const local: LocalAdapter = {
      list: async () => [],
      read: async () => new ArrayBuffer(1),
      write: async (path) => entity(path),
      delete: async () => undefined,
      mkdir: async () => undefined
    };
    const remote: RemoteAdapter = {
      kind: "aliyun-drive",
      authenticate: async () => undefined,
      refreshAuthIfNeeded: async () => undefined,
      stat: async () => null,
      list: async () => [],
      read: async (path) => {
        if (path === "bad.md") {
          throw new Error("下载失败: bad.md, 403");
        }
        return new ArrayBuffer(1);
      },
      write: async (path) => ({ ...entity(path), remoteId: path }),
      mkdir: async (path) => ({ ...entity(path), type: "folder", remoteId: path }),
      delete: async () => undefined,
      move: async () => undefined,
      checkConnectivity: async () => ({ ok: true, message: "ok" })
    };
    const downloadPlan: SyncPlan = {
      operations: ["ok.md", "bad.md"].map((path) => ({
        kind: "download",
        path,
        reason: "test",
        destructive: false,
        remote: { ...entity(path), remoteId: path }
      })),
      summary: {
        upload: 0,
        download: 2,
        deleteLocal: 0,
        deleteRemote: 0,
        conflicts: 0,
        skipped: 0
      }
    };

    const executor = new SyncExecutor(local, remote, SyncJournal.empty("device-1"), () => settings);
    const promise = executor.execute(downloadPlan);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.messages.join("\n")).toContain("bad.md");
  });

  it("archives the remote version before save-triggered local upload overwrites it", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const local: LocalAdapter = {
      list: async () => [],
      read: async () => encode("local latest"),
      write: async (path) => entity(path),
      delete: async () => undefined,
      mkdir: async () => undefined
    };
    const remote: RemoteAdapter = {
      kind: "aliyun-drive",
      authenticate: async () => undefined,
      refreshAuthIfNeeded: async () => undefined,
      stat: async () => null,
      list: async () => [],
      read: async () => encode("remote changed"),
      write: async (path, data) => {
        writes.push({ path, content: decode(data) });
        return { ...entity(path), remoteId: path };
      },
      mkdir: async (path) => ({ ...entity(path), type: "folder", remoteId: path }),
      delete: async () => undefined,
      move: async () => undefined,
      checkConnectivity: async () => ({ ok: true, message: "ok" })
    };
    const uploadPlan: SyncPlan = {
      operations: [{
        kind: "upload",
        path: "a.md",
        reason: "test",
        destructive: false,
        archiveRemoteBeforeWrite: true,
        local: entity("a.md"),
        remote: { ...entity("a.md"), remoteId: "remote-a" }
      }],
      summary: {
        upload: 1,
        download: 0,
        deleteLocal: 0,
        deleteRemote: 0,
        conflicts: 1,
        skipped: 0
      }
    };

    const executor = new SyncExecutor(local, remote, SyncJournal.empty("device-1"), () => settings);
    const result = await executor.execute(uploadPlan);

    expect(result.applied).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(writes).toHaveLength(2);
    expect(writes[0].path).toMatch(/^\.obsidian-aliyun-sync\/conflicts\/a\.conflict\.Device-remote\.\d{8}-\d{6}\.md$/);
    expect(writes[0].content).toBe("remote changed");
    expect(writes[1]).toEqual({ path: "a.md", content: "local latest" });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encode(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer;
}

function decode(data: ArrayBuffer): string {
  return new TextDecoder().decode(data);
}
