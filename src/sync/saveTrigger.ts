export const DEFAULT_SAVE_SYNC_PATH_LIMIT = 20;

export interface SaveSyncDecision {
  ok: boolean;
  reason?: string;
}

export function shouldRunSaveTriggeredSync(paths: string[], limit = DEFAULT_SAVE_SYNC_PATH_LIMIT): SaveSyncDecision {
  if (paths.length === 0) {
    return { ok: false, reason: "no changed paths" };
  }
  if (paths.length > limit) {
    return {
      ok: false,
      reason: `save-triggered sync skipped because Obsidian reported ${paths.length} path events at once`
    };
  }
  return { ok: true };
}
