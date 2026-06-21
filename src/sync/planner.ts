import { canMergeMarkdown } from "./conflict";
import type { AliyunSyncSettings, SyncBaseRecord, SyncEntity, SyncOperation, SyncPlan } from "../types";

export function buildSyncPlan(
  locals: SyncEntity[],
  remotes: SyncEntity[],
  baseRecords: Record<string, SyncBaseRecord>,
  settings: Pick<AliyunSyncSettings, "enableDeleteSync" | "markdownMergeSizeLimitBytes" | "initialSyncConflictStrategy">
): SyncPlan {
  const localMap = mapByPath(locals);
  const remoteMap = mapByPath(remotes);
  const paths = new Set<string>([
    ...Object.keys(localMap),
    ...Object.keys(remoteMap),
    ...Object.keys(baseRecords)
  ]);

  const operations: SyncOperation[] = [];
  for (const path of Array.from(paths).sort()) {
    const local = localMap[path];
    const remote = remoteMap[path];
    const base = baseRecords[path];
    operations.push(decide(path, local, remote, base, settings));
  }
  const filtered = operations.filter((op) => op.kind !== "skip" || op.reason.includes("conflict"));
  return {
    operations: filtered,
    summary: summarize(filtered)
  };
}

function decide(
  path: string,
  local: SyncEntity | undefined,
  remote: SyncEntity | undefined,
  base: SyncBaseRecord | undefined,
  settings: Pick<AliyunSyncSettings, "enableDeleteSync" | "markdownMergeSizeLimitBytes" | "initialSyncConflictStrategy">
): SyncOperation {
  if (!local && !remote) {
    return op(path, "skip", "本地和云端都不存在", false, local, remote, base);
  }

  if (!base) {
    if (local && !remote) {
      return op(path, local.type === "folder" ? "mkdir-remote" : "upload", "本地新增，云端不存在", false, local, remote, base);
    }
    if (!local && remote) {
      return op(path, remote.type === "folder" ? "mkdir-local" : "download", "云端新增，本地不存在", false, local, remote, base);
    }
    if (local && remote && sameContent(local, remote)) {
      return op(path, "adopt", "首次记录时两边内容相同，建立同步基准", false, local, remote, base);
    }
    if (local && remote) {
      return decideInitialSamePath(path, local, remote, base, settings);
    }
    return op(path, "skip", "首次记录状态无法判断", false, local, remote, base);
  }

  const localChanged = hasChanged(local, base.local);
  const remoteChanged = hasChanged(remote, base.remote);
  const localDeleted = Boolean(base.local && !local);
  const remoteDeleted = Boolean(base.remote && !remote);

  if (!localChanged && !remoteChanged) {
    return op(path, "skip", "两边都未变化", false, local, remote, base);
  }

  if (localDeleted && !remoteChanged) {
    return settings.enableDeleteSync
      ? op(path, "delete-remote", "本地删除，云端未变化", true, local, remote, base)
      : op(path, "skip", "本地删除但删除同步未开启", false, local, remote, base);
  }

  if (remoteDeleted && !localChanged) {
    return settings.enableDeleteSync
      ? op(path, "delete-local", "云端删除，本地未变化", true, local, remote, base)
      : op(path, "skip", "云端删除但删除同步未开启", false, local, remote, base);
  }

  if (localChanged && !remoteChanged && local) {
    return op(path, local.type === "folder" ? "mkdir-remote" : "upload", "本地变化，云端未变化", false, local, remote, base);
  }

  if (remoteChanged && !localChanged && remote) {
    return op(path, remote.type === "folder" ? "mkdir-local" : "download", "云端变化，本地未变化", false, local, remote, base);
  }

  if (local && remote && sameContent(local, remote)) {
    return op(path, "skip", "两边都变化但最终内容相同", false, local, remote, base);
  }

  if (local && remote && local.type === "file" && remote.type === "file" && canMergeMarkdown(path, Math.max(local.size, remote.size), settings.markdownMergeSizeLimitBytes)) {
    return op(path, "merge-markdown", "本地和云端都修改了 markdown，尝试合并", false, local, remote, base);
  }

  return op(path, "duplicate-conflict", "本地和云端都发生变化，保留冲突副本", false, local, remote, base);
}

function decideInitialSamePath(
  path: string,
  local: SyncEntity,
  remote: SyncEntity,
  base: SyncBaseRecord | undefined,
  settings: Pick<AliyunSyncSettings, "initialSyncConflictStrategy">
): SyncOperation {
  if (local.type !== remote.type) {
    return op(path, "duplicate-conflict", "首次记录时同路径类型不同", false, local, remote, base);
  }
  if (local.type === "file" && remote.type === "file" && local.size === remote.size && (!isSha1(local.hash) || !isSha1(remote.hash))) {
    return op(path, "adopt", "首次记录同路径大小相同但缺少可比较内容 hash，先建立同步基准", false, local, remote, base);
  }
  switch (settings.initialSyncConflictStrategy) {
    case "prefer-local":
      return op(path, local.type === "folder" ? "mkdir-remote" : "upload", "首次记录同路径不同，按设置以本地为准", false, local, remote, base);
    case "prefer-remote":
      return op(path, remote.type === "folder" ? "mkdir-local" : "download", "首次记录同路径不同，按设置以云端为准", false, local, remote, base);
    case "keep-both":
      return op(path, "duplicate-conflict", "首次记录同路径不同，按设置保留两份", false, local, remote, base);
    case "prefer-newer":
    default:
      return local.mtime >= remote.mtime
        ? op(path, local.type === "folder" ? "mkdir-remote" : "upload", "首次记录同路径不同，较新的本地文件胜出", false, local, remote, base)
        : op(path, remote.type === "folder" ? "mkdir-local" : "download", "首次记录同路径不同，较新的云端文件胜出", false, local, remote, base);
  }
}

function hasChanged(current: SyncEntity | undefined, base: SyncEntity | undefined): boolean {
  if (!base && !current) {
    return false;
  }
  if (!base || !current) {
    return true;
  }
  return !sameContent(current, base);
}

function sameContent(a: SyncEntity, b: SyncEntity): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (isSha1(a.hash) && isSha1(b.hash)) {
    return a.hash.toUpperCase() === b.hash.toUpperCase();
  }
  return a.size === b.size && Math.floor(a.mtime / 1000) === Math.floor(b.mtime / 1000);
}

function isSha1(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function op(
  path: string,
  kind: SyncOperation["kind"],
  reason: string,
  destructive: boolean,
  local?: SyncEntity,
  remote?: SyncEntity,
  base?: SyncBaseRecord
): SyncOperation {
  return { path, kind, reason, destructive, local, remote, base };
}

function mapByPath(items: SyncEntity[]): Record<string, SyncEntity> {
  return Object.fromEntries(items.map((item) => [item.path, item]));
}

function summarize(operations: SyncOperation[]): SyncPlan["summary"] {
  return {
    upload: operations.filter((op) => op.kind === "upload" || op.kind === "mkdir-remote").length,
    download: operations.filter((op) => op.kind === "download" || op.kind === "mkdir-local").length,
    deleteLocal: operations.filter((op) => op.kind === "delete-local").length,
    deleteRemote: operations.filter((op) => op.kind === "delete-remote").length,
    conflicts: operations.filter((op) => op.kind === "merge-markdown" || op.kind === "duplicate-conflict").length,
    skipped: operations.filter((op) => op.kind === "skip").length
  };
}
