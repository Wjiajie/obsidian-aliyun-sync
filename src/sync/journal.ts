import type { SyncBaseRecord, SyncEntity, SyncJournalData } from "../types";

export class SyncJournal {
  private data: SyncJournalData;

  constructor(data: SyncJournalData) {
    this.data = data;
  }

  static empty(vaultId: string): SyncJournal {
    return new SyncJournal({
      version: 1,
      vaultId,
      records: {}
    });
  }

  static fromUnknown(vaultId: string, raw: unknown): SyncJournal {
    if (!raw || typeof raw !== "object") {
      return SyncJournal.empty(vaultId);
    }
    const candidate = raw as Partial<SyncJournalData>;
    if (candidate.version !== 1 || !candidate.records) {
      return SyncJournal.empty(vaultId);
    }
    return new SyncJournal({
      version: 1,
      vaultId: candidate.vaultId || vaultId,
      records: candidate.records
    });
  }

  get records(): Record<string, SyncBaseRecord> {
    return this.data.records;
  }

  toJSON(): SyncJournalData {
    return this.data;
  }

  markSynced(path: string, local: SyncEntity | undefined, remote: SyncEntity | undefined, baseText: string | undefined, deviceId: string): void {
    if (!local && !remote) {
      delete this.data.records[path];
      return;
    }
    this.data.records[path] = {
      path,
      local,
      remote,
      baseText,
      lastSuccessAt: Date.now(),
      deviceId
    };
  }

  markDeleted(path: string): void {
    delete this.data.records[path];
  }
}
