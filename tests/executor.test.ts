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
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
