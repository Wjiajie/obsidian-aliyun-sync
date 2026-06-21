import { App, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile } from "obsidian";
import { AliyunDriveAdapter } from "./remote/aliyunDriveAdapter";
import { LocalVaultAdapter } from "./local/localVaultAdapter";
import { SyncJournal } from "./sync/journal";
import { SyncOrchestrator } from "./sync/orchestrator";
import { formatSyncProgress } from "./sync/progress";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";
import type { AliyunSyncSettings, AuthState, SyncJournalData, SyncProgress } from "./types";

interface PluginData {
  settings?: Partial<AliyunSyncSettings>;
  journal?: SyncJournalData;
}

export default class AliyunSyncPlugin extends Plugin {
  settings: AliyunSyncSettings = DEFAULT_SETTINGS;
  journal: SyncJournal = SyncJournal.empty("default");
  private remote!: AliyunDriveAdapter;
  private local!: LocalVaultAdapter;
  private orchestrator!: SyncOrchestrator;
  private statusEl?: HTMLElement;
  private saveTimer?: number;

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.local = new LocalVaultAdapter(this.app.vault, () => this.settings);
    this.remote = new AliyunDriveAdapter(
      () => this.settings,
      async (auth) => this.saveAuth(auth)
    );
    this.orchestrator = new SyncOrchestrator(
      this.local,
      this.remote,
      () => this.settings,
      () => this.journal,
      async (journal) => this.saveJournal(journal),
      async (summary) => {
        this.settings.lastSyncSummary = summary;
        await this.saveSettings();
        this.setStatus(summary);
      },
      (progress) => this.handleSyncProgress(progress)
    );

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("aliyun-sync-status");
    this.setStatus("阿里云盘同步已加载");
    this.addRibbonIcon("cloud", "同步到阿里云盘", () => void this.runSync("manual"));

    this.addSettingTab(new AliyunSyncSettingTab(this.app, this));
    this.registerCommands();
    this.registerProtocolHandler();
    this.registerAutoSync();
  }

  onunload(): void {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }
  }

  async startAuth(): Promise<void> {
    try {
      await this.remote.authenticate();
      new Notice("阿里云盘连接成功，refresh_token 已可用");
      this.setStatus("阿里云盘已连接");
    } catch (error) {
      new Notice(`无法连接阿里云盘: ${messageOf(error)}`);
    }
  }

  async testConnection(): Promise<void> {
    const result = await this.remote.checkConnectivity();
    new Notice(result.message);
    this.setStatus(result.message);
  }

  async runSync(trigger: "manual" | "startup" | "interval" | "save"): Promise<void> {
    try {
      this.setStatus("正在同步...");
      this.statusEl?.addClass("is-syncing");
      await this.orchestrator.run(trigger);
    } catch (error) {
      const message = messageOf(error);
      if (message.includes("同步正在进行中")) {
        this.setStatus("同步已在进行中");
        return;
      }
      new Notice(`同步失败: ${message}`);
      this.setStatus(`同步失败: ${message}`);
    } finally {
      this.statusEl?.removeClass("is-syncing");
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      journal: this.journal.toJSON()
    } satisfies PluginData);
  }

  private async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as PluginData | null;
    this.settings = normalizeSettings(data?.settings);
    this.journal = SyncJournal.fromUnknown(this.settings.deviceId, data?.journal);
  }

  private async saveAuth(auth: AuthState): Promise<void> {
    this.settings.auth = auth;
    await this.saveSettings();
  }

  private async saveJournal(journal: SyncJournalData): Promise<void> {
    this.journal = new SyncJournal(journal);
    await this.saveSettings();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "aliyun-sync-run",
      name: "同步到阿里云盘",
      callback: () => void this.runSync("manual")
    });
    this.addCommand({
      id: "aliyun-sync-login",
      name: "用 refresh_token 连接阿里云盘",
      callback: () => void this.startAuth()
    });
    this.addCommand({
      id: "aliyun-sync-test-connection",
      name: "测试阿里云盘连接",
      callback: () => void this.testConnection()
    });
  }

  private registerProtocolHandler(): void {
    this.registerObsidianProtocolHandler("aliyun-sync-auth", async (params) => {
      const code = Array.isArray(params.code) ? params.code[0] : params.code;
      if (!code) {
        new Notice("阿里云盘授权回调缺少 code");
        return;
      }
      try {
        await this.remote.completeOAuth(code);
        new Notice("阿里云盘登录成功");
        this.setStatus("阿里云盘已登录");
      } catch (error) {
        new Notice(`阿里云盘登录失败: ${messageOf(error)}`);
      }
    });
  }

  private registerAutoSync(): void {
    if (this.settings.autoSyncOnStartup) {
      const startupTimer = window.setTimeout(
        () => void this.runSync("startup"),
        this.settings.startupSyncDelaySeconds * 1000
      );
      this.register(() => window.clearTimeout(startupTimer));
    }
    if (this.settings.autoSyncIntervalMinutes > 0) {
      this.registerInterval(
        window.setInterval(
          () => void this.runSync("interval"),
          this.settings.autoSyncIntervalMinutes * 60_000
        )
      );
    }
    const scheduleSaveSync = (file: TAbstractFile) => {
      if (this.local.isSuppressingEvents()) {
        return;
      }
      if (!file.path || this.settings.syncOnSaveDebounceSeconds <= 0) {
        return;
      }
      if (this.saveTimer) {
        window.clearTimeout(this.saveTimer);
      }
      this.saveTimer = window.setTimeout(
        () => void this.runSync("save"),
        this.settings.syncOnSaveDebounceSeconds * 1000
      );
    };
    this.registerEvent(this.app.vault.on("modify", scheduleSaveSync));
    this.registerEvent(this.app.vault.on("create", scheduleSaveSync));
    this.registerEvent(this.app.vault.on("delete", scheduleSaveSync));
    this.registerEvent(this.app.vault.on("rename", scheduleSaveSync));
  }

  private setStatus(text: string): void {
    if (this.statusEl) {
      this.statusEl.setText(text);
    }
  }

  private handleSyncProgress(progress: SyncProgress): void {
    this.setStatus(formatSyncProgress(progress));
  }
}

class AliyunSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: AliyunSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "阿里云盘同步" });
    this.addSectionTitle("连接阿里云盘");

    new Setting(containerEl)
      .setName("阿里云盘 Open refresh_token")
      .setDesc("从 OpenList Token 获取工具取得。它相当于登录凭证，只保存在本地，请不要分享给别人。")
      .addText((text) =>
        text
          .setPlaceholder("粘贴 refresh_token")
          .setValue(this.plugin.settings.auth?.refreshToken ?? "")
          .onChange(async (value) => {
            const refreshToken = value.trim();
            this.plugin.settings.auth = refreshToken
              ? {
                  accessToken: "",
                  refreshToken,
                  expiresAt: 0
                }
              : undefined;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("获取 refresh_token")
      .setDesc("打开 OpenList Token 获取工具，选择“阿里云盘（OAuth2）扫码登录”，勾选使用 OpenList 提供的参数。")
      .addButton((button) =>
        button
          .setButtonText("打开工具")
          .setIcon("external-link")
          .onClick(() => window.open("https://api.oplist.org/"))
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("用于确认当前 refresh_token 和云端文件夹可访问。")
      .addButton((button) =>
        button
          .setButtonText("测试")
          .setIcon("activity")
          .onClick(() => void this.plugin.testConnection())
      );

    new Setting(containerEl)
      .setName("连接阿里云盘")
      .setDesc("粘贴或更新 refresh_token 后，点击这里刷新登录状态。")
      .addButton((button) =>
        button
          .setButtonText(this.plugin.settings.auth?.accessToken ? "重新连接" : "连接")
          .setIcon("plug")
          .setCta()
          .onClick(() => void this.plugin.startAuth())
      );

    this.addSectionTitle("同步设置");

    new Setting(containerEl)
      .setName("云端同步文件夹")
      .setDesc("这是阿里云盘里的云端路径，不是本地文件夹。多台设备需要填写同一个路径。")
      .addText((text) =>
        text
          .setPlaceholder("/Apps/ObsidianSync/MyVault")
          .setValue(this.plugin.settings.remoteRootPath)
          .onChange(async (value) => {
            this.plugin.settings.remoteRootPath = value.trim() || "/Apps/ObsidianSync";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("设备名称")
      .setDesc("用于冲突文件命名和同步记录。")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.deviceName)
          .onChange(async (value) => {
            this.plugin.settings.deviceName = value.trim() || "Obsidian Device";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("立即同步")
      .setDesc("会根据本地、云端和上一轮同步记录生成计划。大量删除会被拦截。")
      .addButton((button) =>
        button
          .setButtonText("同步")
          .setIcon("cloud")
          .setCta()
          .onClick(() => void this.plugin.runSync("manual"))
      );

    this.renderAdvancedSettings(containerEl);

    if (this.plugin.settings.lastSyncSummary) {
      containerEl.createEl("p", {
        text: `最近同步: ${this.plugin.settings.lastSyncSummary}`
      });
    }
  }

  private addSectionTitle(text: string): void {
    this.containerEl.createEl("h3", {
      text,
      cls: "aliyun-sync-section-title"
    });
  }

  private renderAdvancedSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("进阶配置")
      .setDesc("默认值已适合大多数个人知识库。只有需要调整自动同步、删除保护或自建续期接口时再展开。")
      .addButton((button) =>
        button
          .setButtonText(this.plugin.settings.advancedSettingsOpen ? "收起" : "展开")
          .setIcon(this.plugin.settings.advancedSettingsOpen ? "chevron-up" : "chevron-down")
          .onClick(async () => {
            this.plugin.settings.advancedSettingsOpen = !this.plugin.settings.advancedSettingsOpen;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (!this.plugin.settings.advancedSettingsOpen) {
      return;
    }

    const advancedEl = containerEl.createDiv({ cls: "aliyun-sync-advanced" });

    new Setting(advancedEl)
      .setName("OpenList 续期接口")
      .setDesc("默认使用 OpenList 官方接口。若你自建了 OpenList APIPages，可以替换成自己的 /alicloud/renewapi 地址。")
      .addText((text) =>
        text
          .setPlaceholder("https://api.oplist.org/alicloud/renewapi")
          .setValue(this.plugin.settings.tokenRefreshApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.tokenRefreshApiUrl = value.trim() || "https://api.oplist.org/alicloud/renewapi";
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("OpenList 授权类型")
      .setDesc("使用 OpenList 工具扫码登录取得 token 时保持默认 alicloud_qr 即可。")
      .addText((text) =>
        text
          .setPlaceholder("alicloud_qr")
          .setValue(this.plugin.settings.tokenRefreshAppsType)
          .onChange(async (value) => {
            this.plugin.settings.tokenRefreshAppsType = value.trim() || "alicloud_qr";
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("同步 .obsidian 配置目录")
      .setDesc("默认关闭。开启后会同步部分配置文件，但仍会遵守忽略规则。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeObsidianConfig)
          .onChange(async (value) => {
            this.plugin.settings.includeObsidianConfig = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("启动后自动检查")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("启动后同步延迟（秒）")
      .setDesc("打开 Obsidian 后等待多久触发第一次同步。0 表示立即触发。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.startupSyncDelaySeconds))
          .onChange(async (value) => {
            this.plugin.settings.startupSyncDelaySeconds = Math.max(0, Number(value) || 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("定时同步间隔（分钟）")
      .setDesc("0 表示关闭定时同步。修改后重启 Obsidian 生效。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
          .onChange(async (value) => {
            this.plugin.settings.autoSyncIntervalMinutes = Math.max(0, Number(value) || 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("保存后同步延迟（秒）")
      .setDesc("0 表示关闭保存后自动同步。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.syncOnSaveDebounceSeconds))
          .onChange(async (value) => {
            this.plugin.settings.syncOnSaveDebounceSeconds = Math.max(0, Number(value) || 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("并行传输数量")
      .setDesc("同时上传或下载的文件数。建议保持 3；网络稳定时可试 4-5，频繁失败或限流时降到 1-2。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxParallelTransfers))
          .onChange(async (value) => {
            this.plugin.settings.maxParallelTransfers = Math.min(6, Math.max(1, Number(value) || 3));
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("首次同名文件策略")
      .setDesc("没有历史记录时，如果本地和云端有同路径但不同内容的文件，默认以较新文件为准，避免批量生成 conflict 文件。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("prefer-newer", "以较新文件为准")
          .addOption("prefer-local", "以本地为准")
          .addOption("prefer-remote", "以云端为准")
          .addOption("keep-both", "保留两份")
          .setValue(this.plugin.settings.initialSyncConflictStrategy)
          .onChange(async (value) => {
            this.plugin.settings.initialSyncConflictStrategy = value as AliyunSyncSettings["initialSyncConflictStrategy"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("启用删除同步")
      .setDesc("关闭后，本地或云端删除不会自动传播。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableDeleteSync)
          .onChange(async (value) => {
            this.plugin.settings.enableDeleteSync = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("最大删除数量")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxDeleteCount))
          .onChange(async (value) => {
            this.plugin.settings.maxDeleteCount = Math.max(1, Number(value) || 1);
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedEl)
      .setName("最大删除比例")
      .setDesc("超过该百分比会停止自动同步。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxDeletePercentage))
          .onChange(async (value) => {
            this.plugin.settings.maxDeletePercentage = Math.min(100, Math.max(1, Number(value) || 1));
            await this.plugin.saveSettings();
          })
      );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
