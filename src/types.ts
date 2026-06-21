export type RemoteProviderKind = "aliyun-drive";
export type InitialSyncConflictStrategy = "prefer-newer" | "prefer-local" | "prefer-remote" | "keep-both";

export interface AuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AliyunSyncSettings {
  provider: RemoteProviderKind;
  clientId: string;
  redirectUri: string;
  tokenRefreshApiUrl: string;
  tokenRefreshAppsType: string;
  remoteRootPath: string;
  syncScopes: string[];
  ignorePatterns: string[];
  includeObsidianConfig: boolean;
  autoSyncOnStartup: boolean;
  startupSyncDelaySeconds: number;
  autoSyncIntervalMinutes: number;
  syncOnSaveDebounceSeconds: number;
  maxParallelTransfers: number;
  initialSyncConflictStrategy: InitialSyncConflictStrategy;
  enableDeleteSync: boolean;
  maxDeleteCount: number;
  maxDeletePercentage: number;
  markdownMergeSizeLimitBytes: number;
  deviceName: string;
  deviceId: string;
  advancedSettingsOpen: boolean;
  auth?: AuthState;
  lastSyncSummary?: string;
}

export interface SyncEntity {
  path: string;
  type: "file" | "folder";
  size: number;
  mtime: number;
  hash?: string;
  remoteId?: string;
  etag?: string;
}

export interface SyncBaseRecord {
  path: string;
  local?: SyncEntity;
  remote?: SyncEntity;
  baseText?: string;
  deletedLocalAt?: number;
  deletedRemoteAt?: number;
  lastSuccessAt: number;
  deviceId: string;
}

export type SyncOperationKind =
  | "adopt"
  | "upload"
  | "download"
  | "delete-local"
  | "delete-remote"
  | "mkdir-local"
  | "mkdir-remote"
  | "merge-markdown"
  | "duplicate-conflict"
  | "skip";

export interface SyncOperation {
  path: string;
  kind: SyncOperationKind;
  reason: string;
  destructive: boolean;
  local?: SyncEntity;
  remote?: SyncEntity;
  base?: SyncBaseRecord;
}

export interface SyncPlan {
  operations: SyncOperation[];
  summary: {
    upload: number;
    download: number;
    deleteLocal: number;
    deleteRemote: number;
    conflicts: number;
    skipped: number;
  };
}

export interface SyncProgress {
  phase: "auth" | "scan" | "plan" | "execute" | "metadata" | "done";
  message: string;
  current?: number;
  total?: number;
  path?: string;
}

export interface RemoteEntry extends SyncEntity {
  remoteId: string;
}

export interface WriteMeta {
  mtime: number;
  ctime?: number;
}

export interface ConnectivityResult {
  ok: boolean;
  message: string;
}

export interface SyncJournalData {
  version: 1;
  vaultId: string;
  records: Record<string, SyncBaseRecord>;
}

export interface RemoteMetadata {
  protocolVersion: 1;
  vaultId: string;
  updatedAt: number;
  updatedBy: string;
  devices: Record<string, { name: string; lastSeenAt: number }>;
  tombstones: Record<string, { deletedAt: number; deletedBy: string }>;
}

export interface RemoteAdapter {
  kind: RemoteProviderKind;
  authenticate(): Promise<void>;
  refreshAuthIfNeeded(): Promise<void>;
  stat(path: string): Promise<RemoteEntry | null>;
  list(path: string): Promise<RemoteEntry[]>;
  read(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer, meta: WriteMeta): Promise<RemoteEntry>;
  mkdir(path: string): Promise<RemoteEntry>;
  delete(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  checkConnectivity(): Promise<ConnectivityResult>;
}

export interface LocalEntry extends SyncEntity {
  path: string;
}

export interface LocalAdapter {
  list(): Promise<LocalEntry[]>;
  read(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer, mtime?: number): Promise<SyncEntity>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}
