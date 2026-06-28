import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/settings";

describe("settings normalization", () => {
  it("uses quiet auto sync defaults", () => {
    const settings = normalizeSettings({});
    expect(settings.includeObsidianConfig).toBe(false);
    expect(settings.autoSyncOnStartup).toBe(false);
    expect(settings.showSyncCompletionNotice).toBe(false);
    expect(settings.startupSyncDelaySeconds).toBe(1);
    expect(settings.autoSyncIntervalMinutes).toBe(0);
    expect(settings.syncOnSaveDebounceSeconds).toBe(1);
  });

  it("keeps startup sync delay configurable and clamps invalid values", () => {
    expect(normalizeSettings({ startupSyncDelaySeconds: 30 }).startupSyncDelaySeconds).toBe(30);
    expect(normalizeSettings({ startupSyncDelaySeconds: -5 }).startupSyncDelaySeconds).toBe(0);
  });

  it("keeps parallel transfer count in a conservative range", () => {
    expect(normalizeSettings({ maxParallelTransfers: 4 }).maxParallelTransfers).toBe(4);
    expect(normalizeSettings({ maxParallelTransfers: 0 }).maxParallelTransfers).toBe(3);
    expect(normalizeSettings({ maxParallelTransfers: 99 }).maxParallelTransfers).toBe(6);
  });

  it("defaults and clamps bulk download protection thresholds", () => {
    expect(normalizeSettings({}).maxDownloadCount).toBe(100);
    expect(normalizeSettings({ maxDownloadCount: 0 }).maxDownloadCount).toBe(100);
    expect(normalizeSettings({ maxDownloadPercentage: 150 }).maxDownloadPercentage).toBe(100);
    expect(normalizeSettings({ maxDownloadPercentage: -1 }).maxDownloadPercentage).toBe(1);
  });

  it("keeps sync completion notices off by default", () => {
    expect(normalizeSettings({}).showSyncCompletionNotice).toBe(false);
    expect(normalizeSettings({ showSyncCompletionNotice: true }).showSyncCompletionNotice).toBe(true);
  });

  it("defaults to ignoring generated conflict copies", () => {
    const settings = normalizeSettings(null);
    expect(settings.ignorePatterns).toContain("*.conflict.*");
    expect(settings.initialSyncConflictStrategy).toBe("prefer-newer");
  });

  it("adds new default ignore patterns when loading old saved settings", () => {
    const settings = normalizeSettings({ ignorePatterns: [".trash/**"] });
    expect(settings.ignorePatterns).toContain("*.conflict.*");
    expect(settings.ignorePatterns).toContain("**/*.conflict.*");
  });
});
