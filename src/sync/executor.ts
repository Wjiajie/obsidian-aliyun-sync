import { decodeText, encodeText } from "../lib/hash";
import { isMarkdownPath } from "../lib/path";
import { createConflictArchivePath, mergeMarkdown } from "./conflict";
import { checkDeleteProtection } from "./deleteProtection";
import { operationProgressLabel } from "./progress";
import type { AliyunSyncSettings, LocalAdapter, RemoteAdapter, SyncOperation, SyncPlan, SyncProgress } from "../types";
import { SyncJournal } from "./journal";

export interface SyncExecutionResult {
  applied: number;
  skipped: number;
  failed: number;
  conflicts: number;
  messages: string[];
}

export class SyncExecutor {
  constructor(
    private readonly local: LocalAdapter,
    private readonly remote: RemoteAdapter,
    private readonly journal: SyncJournal,
    private readonly getSettings: () => AliyunSyncSettings,
    private readonly reportProgress: (progress: SyncProgress) => void = () => undefined
  ) {}

  async execute(plan: SyncPlan): Promise<SyncExecutionResult> {
    const settings = this.getSettings();
    const totalFiles = Math.max(Object.keys(this.journal.records).length, plan.operations.length);
    const deleteCheck = checkDeleteProtection(plan.operations, totalFiles, settings);
    if (!deleteCheck.ok) {
      throw new Error(deleteCheck.reason);
    }

    const result: SyncExecutionResult = {
      applied: 0,
      skipped: 0,
      failed: 0,
      conflicts: 0,
      messages: []
    };

    const orderedOperations = ordered(plan.operations);
    await this.executeSequential(orderedOperations.filter(isBeforeTransferOperation), result, orderedOperations.length, 0);

    const beforeTransferCount = orderedOperations.filter(isBeforeTransferOperation).length;
    const transferOperations = orderedOperations.filter(isTransferOperation);
    await this.executeTransfers(transferOperations, result, orderedOperations.length, beforeTransferCount);

    const afterTransferOffset = beforeTransferCount + transferOperations.length;
    await this.executeSequential(orderedOperations.filter(isAfterTransferOperation), result, orderedOperations.length, afterTransferOffset);

    return result;
  }

  private async executeSequential(
    operations: SyncOperation[],
    result: SyncExecutionResult,
    total: number,
    offset: number
  ): Promise<void> {
    for (const [index, operation] of operations.entries()) {
      await this.executeOne(operation, result, offset + index + 1, total);
    }
  }

  private async executeTransfers(
    operations: SyncOperation[],
    result: SyncExecutionResult,
    total: number,
    offset: number
  ): Promise<void> {
    let concurrency = this.getSettings().maxParallelTransfers;
    let completed = 0;
    let pending = [...operations];

    while (pending.length > 0) {
      const batch = pending.splice(0, concurrency);
      const settled = await Promise.allSettled(
        batch.map((operation, index) => this.executeOne(operation, result, offset + completed + index + 1, total))
      );

      const failed: SyncOperation[] = [];
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "fulfilled") {
          completed++;
          continue;
        }
        if (!isTransientError(outcome.reason)) {
          this.markOperationFailed(batch[index], outcome.reason, result);
          completed++;
          continue;
        }
        if (concurrency === 1) {
          this.markOperationFailed(batch[index], outcome.reason, result);
          completed++;
          continue;
        }
        failed.push(batch[index]);
      }

      if (failed.length > 0) {
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        result.messages.push(`检测到限流或网络波动，已将本轮并行传输降到 ${concurrency}`);
        pending = [...failed, ...pending];
        await delay(3000);
      }
    }
  }

  private async executeOne(
    operation: SyncOperation,
    result: SyncExecutionResult,
    current: number,
    total: number
  ): Promise<void> {
    this.reportProgress({
      phase: "execute",
      message: operationProgressLabel(operation),
      current,
      total,
      path: operation.path
    });
    if (operation.kind === "skip") {
      result.skipped++;
      return;
    }
    await this.applyOperationWithRetry(operation, result);
    result.applied++;
  }

  private markOperationFailed(operation: SyncOperation, error: unknown, result: SyncExecutionResult): void {
    result.failed++;
    result.messages.push(`${operationProgressLabel(operation)}失败，已跳过: ${operation.path}, ${messageOf(error)}`);
  }

  private async applyOperationWithRetry(operation: SyncOperation, result: SyncExecutionResult): Promise<void> {
    const maxAttempts = isTransferOperation(operation) ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.applyOperation(operation, result);
        return;
      } catch (error) {
        if (attempt === maxAttempts || !isTransientError(error)) {
          throw error;
        }
        await delay(1200 * attempt * attempt);
      }
    }
  }

  private async applyOperation(operation: SyncOperation, result: SyncExecutionResult): Promise<void> {
    const settings = this.getSettings();
    switch (operation.kind) {
      case "mkdir-local":
        await this.local.mkdir(operation.path);
        this.journal.markSynced(operation.path, operation.local, operation.remote, undefined, settings.deviceId);
        break;
      case "mkdir-remote":
        await this.remote.mkdir(operation.path);
        this.journal.markSynced(operation.path, operation.local, operation.remote, undefined, settings.deviceId);
        break;
      case "adopt":
        this.journal.markSynced(operation.path, operation.local, operation.remote, operation.base?.baseText, settings.deviceId);
        break;
      case "upload": {
        const data = await this.local.read(operation.path);
        const remote = await this.remote.write(operation.path, data, { mtime: operation.local?.mtime ?? Date.now() });
        this.journal.markSynced(operation.path, operation.local, remote, isMarkdownPath(operation.path) ? decodeText(data) : undefined, settings.deviceId);
        break;
      }
      case "download": {
        const data = await this.remote.read(operation.path);
        const local = await this.local.write(operation.path, data, operation.remote?.mtime);
        this.journal.markSynced(operation.path, local, operation.remote, isMarkdownPath(operation.path) ? decodeText(data) : undefined, settings.deviceId);
        break;
      }
      case "delete-local":
        await this.local.delete(operation.path);
        this.journal.markDeleted(operation.path);
        break;
      case "delete-remote":
        await this.remote.delete(operation.path);
        this.journal.markDeleted(operation.path);
        break;
      case "merge-markdown": {
        const [localData, remoteData] = await Promise.all([
          this.local.read(operation.path),
          this.remote.read(operation.path)
        ]);
        const merged = mergeMarkdown(operation.base?.baseText, decodeText(localData), decodeText(remoteData));
        const data = encodeText(merged.content);
        const local = await this.local.write(operation.path, data);
        const remote = await this.remote.write(operation.path, data, { mtime: local.mtime });
        this.journal.markSynced(operation.path, local, remote, merged.content, settings.deviceId);
        if (merged.conflicted) {
          result.conflicts++;
          result.messages.push(`已合并但仍含冲突标记: ${operation.path}`);
        }
        break;
      }
      case "duplicate-conflict": {
        if (!operation.local || !operation.remote) {
          result.skipped++;
          return;
        }
        const conflictPath = createConflictArchivePath(operation.path, settings.deviceName);
        const localData = await this.local.read(operation.path);
        await this.remote.write(conflictPath, localData, { mtime: operation.local.mtime });
        const remoteData = await this.remote.read(operation.path);
        const local = await this.local.write(operation.path, remoteData, operation.remote.mtime);
        this.journal.markSynced(operation.path, local, operation.remote, isMarkdownPath(operation.path) ? decodeText(remoteData) : undefined, settings.deviceId);
        result.conflicts++;
        result.messages.push(`已保留本地冲突副本到云端: ${conflictPath}`);
        break;
      }
      default:
        result.skipped++;
    }
  }
}

function ordered(operations: SyncOperation[]): SyncOperation[] {
  const priority: Record<SyncOperation["kind"], number> = {
    adopt: 1,
    "mkdir-local": 1,
    "mkdir-remote": 1,
    upload: 2,
    download: 2,
    "merge-markdown": 3,
    "duplicate-conflict": 3,
    "delete-local": 4,
    "delete-remote": 4,
    skip: 5
  };
  return [...operations].sort((a, b) => priority[a.kind] - priority[b.kind]);
}

function isBeforeTransferOperation(operation: SyncOperation): boolean {
  return operation.kind === "mkdir-local" || operation.kind === "mkdir-remote" || operation.kind === "adopt";
}

function isTransferOperation(operation: SyncOperation): boolean {
  return operation.kind === "upload" || operation.kind === "download";
}

function isAfterTransferOperation(operation: SyncOperation): boolean {
  return !isBeforeTransferOperation(operation) && !isTransferOperation(operation);
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|403|408|409|425|5\d\d|Too Many|timeout|network|限流|频率|上传分片失败|下载失败/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
