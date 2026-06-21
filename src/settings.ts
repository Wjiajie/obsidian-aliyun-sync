import type { AliyunSyncSettings } from "./types";
import { DEFAULT_OPENLIST_APPS_TYPE, DEFAULT_OPENLIST_RENEW_API } from "./remote/openListAuth";

export const DEFAULT_SETTINGS: AliyunSyncSettings = {
  provider: "aliyun-drive",
  clientId: "",
  redirectUri: "obsidian://aliyun-sync-auth",
  tokenRefreshApiUrl: DEFAULT_OPENLIST_RENEW_API,
  tokenRefreshAppsType: DEFAULT_OPENLIST_APPS_TYPE,
  remoteRootPath: "/Apps/ObsidianSync",
  syncScopes: ["/"],
  ignorePatterns: [
    ".obsidian-aliyun-sync/**",
    "*.conflict.*",
    "**/*.conflict.*",
    "*.sync-conflict-*",
    "**/*.sync-conflict-*",
    ".trash/**",
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
    ".obsidian/cache/**"
  ],
  includeObsidianConfig: false,
  autoSyncOnStartup: true,
  startupSyncDelaySeconds: 10,
  autoSyncIntervalMinutes: 10,
  syncOnSaveDebounceSeconds: 20,
  maxParallelTransfers: 3,
  initialSyncConflictStrategy: "prefer-newer",
  enableDeleteSync: true,
  maxDeleteCount: 20,
  maxDeletePercentage: 30,
  markdownMergeSizeLimitBytes: 512 * 1024,
  deviceName: "",
  deviceId: "",
  advancedSettingsOpen: false,
  lastSyncSummary: ""
};

export function normalizeSettings(raw: Partial<AliyunSyncSettings> | null | undefined): AliyunSyncSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {})
  };
  if (!merged.deviceId) {
    merged.deviceId = generateDeviceId();
  }
  if (!merged.deviceName) {
    merged.deviceName = "Obsidian Device";
  }
  if (!merged.remoteRootPath.startsWith("/")) {
    merged.remoteRootPath = `/${merged.remoteRootPath}`;
  }
  merged.remoteRootPath = merged.remoteRootPath.replace(/\/+$/g, "") || "/";
  merged.ignorePatterns = unique([
    ...DEFAULT_SETTINGS.ignorePatterns,
    ...(raw?.ignorePatterns ?? [])
  ]);
  merged.tokenRefreshApiUrl = merged.tokenRefreshApiUrl || DEFAULT_OPENLIST_RENEW_API;
  merged.tokenRefreshAppsType = merged.tokenRefreshAppsType || DEFAULT_OPENLIST_APPS_TYPE;
  merged.startupSyncDelaySeconds = Math.max(0, Number(merged.startupSyncDelaySeconds) || 0);
  merged.maxParallelTransfers = Math.min(6, Math.max(1, Number(merged.maxParallelTransfers) || 3));
  if (!["prefer-newer", "prefer-local", "prefer-remote", "keep-both"].includes(merged.initialSyncConflictStrategy)) {
    merged.initialSyncConflictStrategy = "prefer-newer";
  }
  return merged;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function generateDeviceId(): string {
  const random = Math.random().toString(36).slice(2);
  return `device-${Date.now().toString(36)}-${random}`;
}
