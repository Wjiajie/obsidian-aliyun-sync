import { Notice } from "obsidian";
import { encodeText } from "../lib/hash";
import { matchesIgnore } from "../lib/path";
import { createRemoteMetadata, serializeRemoteMetadata } from "./remoteMetadata";
import { buildSyncPlan } from "./planner";
import { SyncExecutor, type SyncExecutionResult } from "./executor";
import { SyncJournal } from "./journal";
import type { AliyunSyncSettings, LocalAdapter, RemoteAdapter, SyncJournalData, SyncProgress, SyncRunOptions, SyncTrigger } from "../types";

export class SyncOrchestrator {
  private running = false;

  constructor(
    private readonly local: LocalAdapter,
    private readonly remote: RemoteAdapter,
    private readonly getSettings: () => AliyunSyncSettings,
    private readonly getJournal: () => SyncJournal,
    private readonly persistJournal: (data: SyncJournalData) => Promise<void>,
    private readonly saveSummary: (summary: string) => Promise<void>,
    private readonly reportProgress: (progress: SyncProgress) => void = () => undefined
  ) {}

  async run(trigger: SyncTrigger, options: SyncRunOptions = {}): Promise<SyncExecutionResult> {
    if (this.running) {
      throw new Error("同步正在进行中");
    }
    this.running = true;
    try {
      const settings = this.getSettings();
      this.reportProgress({ phase: "auth", message: "连接阿里云盘", current: 1, total: 5 });
      await this.remote.refreshAuthIfNeeded();
      this.reportProgress({ phase: "scan", message: "扫描本地和云端文件", current: 2, total: 5 });
      const [locals, remotes] = await Promise.all([this.local.list(), this.remote.list("")]);
      const filteredRemotes = remotes.filter((entry) => !matchesIgnore(entry.path, settings.ignorePatterns));
      this.reportProgress({ phase: "plan", message: "生成同步计划", current: 3, total: 5 });
      const journal = this.getJournal();
      const plan = buildSyncPlan(locals, filteredRemotes, journal.records, settings, options);
      const executor = new SyncExecutor(this.local, this.remote, journal, this.getSettings, this.reportProgress);
      const result = await executor.execute(plan);
      this.reportProgress({ phase: "metadata", message: "写入同步记录", current: 4, total: 5 });
      await this.writeRemoteMetadata();
      await this.persistJournal(journal.toJSON());
      const summary = [
        `${new Date().toLocaleString()} (${trigger})`,
        `上传 ${plan.summary.upload}`,
        `下载 ${plan.summary.download}`,
        `冲突 ${plan.summary.conflicts}`,
        `本地删除 ${plan.summary.deleteLocal}`,
        `云端删除 ${plan.summary.deleteRemote}`,
        `执行 ${result.applied}`,
        `失败 ${result.failed}`
      ].join(" / ");
      await this.saveSummary(summary);
      this.reportProgress({ phase: "done", message: "同步完成", current: 5, total: 5 });
      if (settings.showSyncCompletionNotice) {
        new Notice(`阿里云盘同步完成: ${summary}`);
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private async writeRemoteMetadata(): Promise<void> {
    const settings = this.getSettings();
    const metadata = createRemoteMetadata(this.getJournal().toJSON().vaultId, settings.deviceId, settings.deviceName);
    await this.remote.mkdir(".obsidian-aliyun-sync");
    await this.remote.write(
      ".obsidian-aliyun-sync/meta.json",
      encodeText(serializeRemoteMetadata(metadata)),
      { mtime: metadata.updatedAt }
    );
  }
}
