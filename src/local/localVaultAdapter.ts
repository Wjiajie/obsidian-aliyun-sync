import type { Vault } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import { shouldSkipAutoRenamedPath } from "../lib/autoRenamedDuplicate";
import { hashBuffer } from "../lib/hash";
import { matchesIgnore, normalizeVaultPath, parentPath } from "../lib/path";
import type { AliyunSyncSettings, LocalAdapter, LocalEntry, SyncEntity } from "../types";

export class LocalVaultAdapter implements LocalAdapter {
  private suppressUntil = 0;

  constructor(
    private readonly vault: Vault,
    private readonly getSettings: () => AliyunSyncSettings
  ) {}

  isSuppressingEvents(): boolean {
    return Date.now() < this.suppressUntil;
  }

  async list(): Promise<LocalEntry[]> {
    const settings = this.getSettings();
    const files = this.vault.getFiles();
    const entries: LocalEntry[] = [];
    for (const file of files) {
      if (!this.shouldInclude(file.path) || this.isAutoRenamedDuplicate(file.path)) {
        continue;
      }
      const content = await this.vault.adapter.readBinary(file.path);
      entries.push({
        path: normalizeVaultPath(file.path),
        type: "file",
        size: file.stat.size,
        mtime: file.stat.mtime,
        hash: hashBuffer(content)
      });
    }
    if (settings.includeObsidianConfig) {
      const hidden = await this.listAdapterFolder(".obsidian");
      for (const entry of hidden) {
        if (!entries.some((existing) => existing.path === entry.path) && this.shouldInclude(entry.path)) {
          entries.push(entry);
        }
      }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string): Promise<ArrayBuffer> {
    return this.vault.adapter.readBinary(normalizeVaultPath(path));
  }

  async write(path: string, data: ArrayBuffer, mtime?: number): Promise<SyncEntity> {
    const clean = normalizeVaultPath(path);
    await this.ensureParent(clean);
    this.suppressUntil = Date.now() + 3000;
    await this.vault.adapter.writeBinary(clean, data, mtime ? { mtime } : undefined);
    const stat = await this.vault.adapter.stat(clean);
    return {
      path: clean,
      type: "file",
      size: stat?.size ?? data.byteLength,
      mtime: stat?.mtime ?? mtime ?? Date.now(),
      hash: hashBuffer(data)
    };
  }

  async delete(path: string): Promise<void> {
    const clean = normalizeVaultPath(path);
    if (await this.vault.adapter.exists(clean)) {
      this.suppressUntil = Date.now() + 3000;
      await this.vault.adapter.remove(clean);
    }
  }

  async mkdir(path: string): Promise<void> {
    const clean = normalizeVaultPath(path);
    if (clean && !(await this.vault.adapter.exists(clean))) {
      await this.ensureFolder(clean);
    }
  }

  private shouldInclude(path: string): boolean {
    const settings = this.getSettings();
    const clean = normalizeVaultPath(path);
    if (!settings.includeObsidianConfig && clean.startsWith(".obsidian/")) {
      return false;
    }
    if (matchesIgnore(clean, settings.ignorePatterns)) {
      return false;
    }
    if (settings.syncScopes.length === 0 || settings.syncScopes.includes("/")) {
      return true;
    }
    return settings.syncScopes.some((scope) => {
      const cleanScope = normalizeVaultPath(scope);
      return clean === cleanScope || clean.startsWith(`${cleanScope}/`);
    });
  }

  private async listAdapterFolder(path: string): Promise<LocalEntry[]> {
    if (!(await this.vault.adapter.exists(path))) {
      return [];
    }
    const listed = await this.vault.adapter.list(path);
    const entries: LocalEntry[] = [];
    for (const filePath of listed.files) {
      const clean = normalizeVaultPath(filePath);
      if (this.isAutoRenamedDuplicate(clean)) {
        continue;
      }
      const stat = await this.vault.adapter.stat(clean);
      const data = await this.vault.adapter.readBinary(clean);
      entries.push({
        path: clean,
        type: "file",
        size: stat?.size ?? data.byteLength,
        mtime: stat?.mtime ?? Date.now(),
        hash: hashBuffer(data)
      });
    }
    for (const folderPath of listed.folders) {
      if (this.isAutoRenamedDuplicate(folderPath)) {
        continue;
      }
      entries.push(...(await this.listAdapterFolder(folderPath)));
    }
    return entries;
  }

  private async ensureParent(path: string): Promise<void> {
    const parent = parentPath(path);
    if (parent) {
      await this.ensureFolder(parent);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const clean = normalizeVaultPath(path);
    const parts = clean.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const normalized = normalizePath(current);
      if (!(await this.vault.adapter.exists(normalized))) {
        await this.vault.adapter.mkdir(normalized);
      }
    }
  }

  private isAutoRenamedDuplicate(path: string): boolean {
    return shouldSkipAutoRenamedPath(path, (candidate) => this.vault.getAbstractFileByPath(candidate) !== null);
  }
}

export function fileToLocalEntry(file: TFile): LocalEntry {
  return {
    path: normalizeVaultPath(file.path),
    type: "file",
    size: file.stat.size,
    mtime: file.stat.mtime
  };
}
