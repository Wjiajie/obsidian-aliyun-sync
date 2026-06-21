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
