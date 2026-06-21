import type { SyncOperation, SyncProgress } from "../types";

const OPERATION_LABELS: Record<SyncOperation["kind"], string> = {
  adopt: "记录基准",
  upload: "上传",
  download: "下载",
  "delete-local": "删除本地",
  "delete-remote": "删除云端",
  "mkdir-local": "创建本地目录",
  "mkdir-remote": "创建云端目录",
  "merge-markdown": "合并 Markdown",
  "duplicate-conflict": "保留冲突副本",
  skip: "跳过"
};

export function operationProgressLabel(operation: SyncOperation): string {
  return OPERATION_LABELS[operation.kind] ?? operation.kind;
}

export function formatSyncProgress(progress: SyncProgress): string {
  const count = progress.total !== undefined
    ? ` ${progress.current ?? 0}/${progress.total}`
    : "";
  const path = progress.path ? `: ${shortenPath(progress.path)}` : "";
  return `正在同步${count} - ${progress.message}${path}`;
}

function shortenPath(path: string): string {
  if (path.length <= 42) {
    return path;
  }
  return `...${path.slice(-39)}`;
}
