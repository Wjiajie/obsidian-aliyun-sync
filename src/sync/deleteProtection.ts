import type { AliyunSyncSettings, SyncOperation } from "../types";

export interface DeleteProtectionResult {
  ok: boolean;
  reason?: string;
}

export function checkDeleteProtection(
  operations: SyncOperation[],
  totalFiles: number,
  settings: Pick<AliyunSyncSettings, "maxDeleteCount" | "maxDeletePercentage">
): DeleteProtectionResult {
  const deletes = operations.filter((op) => op.kind === "delete-local" || op.kind === "delete-remote");
  if (deletes.length === 0) {
    return { ok: true };
  }
  if (deletes.length > settings.maxDeleteCount) {
    return {
      ok: false,
      reason: `本次计划删除 ${deletes.length} 个文件，超过上限 ${settings.maxDeleteCount}`
    };
  }
  const denominator = Math.max(totalFiles, 1);
  const percentage = (deletes.length / denominator) * 100;
  if (percentage > settings.maxDeletePercentage) {
    return {
      ok: false,
      reason: `本次删除比例 ${percentage.toFixed(1)}%，超过上限 ${settings.maxDeletePercentage}%`
    };
  }
  return { ok: true };
}

export function checkDownloadProtection(
  operations: SyncOperation[],
  totalFiles: number,
  hasSyncHistory: boolean,
  settings: Pick<AliyunSyncSettings, "maxDownloadCount" | "maxDownloadPercentage">
): DeleteProtectionResult {
  if (!hasSyncHistory) {
    return { ok: true };
  }
  const riskyDownloads = operations.filter((op) => op.kind === "download" && Boolean(op.base));
  if (riskyDownloads.length === 0) {
    return { ok: true };
  }
  if (riskyDownloads.length > settings.maxDownloadCount) {
    return {
      ok: false,
      reason: `本次计划覆盖 ${riskyDownloads.length} 个已同步文件，超过上限 ${settings.maxDownloadCount}。这通常表示云端发生了批量改写，为保护本地文件已停止同步。`
    };
  }
  const denominator = Math.max(totalFiles, 1);
  const percentage = (riskyDownloads.length / denominator) * 100;
  if (percentage > settings.maxDownloadPercentage) {
    return {
      ok: false,
      reason: `本次覆盖已同步文件比例 ${percentage.toFixed(1)}%，超过上限 ${settings.maxDownloadPercentage}%。这通常表示云端发生了批量改写，为保护本地文件已停止同步。`
    };
  }
  return { ok: true };
}
