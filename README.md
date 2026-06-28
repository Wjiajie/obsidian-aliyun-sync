# Obsidian Aliyun Drive Sync

Aliyun Drive Sync keeps a local vault in sync with a selected folder in the personal Aliyun Drive cloud app. It uses the Aliyun Drive open file APIs through an OpenList refresh token flow, so it does not require the Aliyun Drive desktop client or a local mirrored folder.

Core features:

- Two-way sync between local files and an Aliyun Drive cloud folder.
- Incremental planning based on local state, remote state, sync history, and SHA-1 content hashes.
- Automatic sync on startup, periodic intervals, and delayed sync after file changes.
- Progress feedback in the status bar for scanning, planning, upload, download, metadata, and completion phases.
- Configurable parallel transfers with retry behavior for transient network or rate-limit failures.
- Conflict handling for Markdown files, with unresolved conflict copies stored inside the plugin metadata folder.
- Delete protection to prevent unexpected large-scale deletion propagation.
- Duplicate-folder protection for Aliyun Drive auto-renamed paths such as `Folder(1)` or `Folder(2)`.

Security notes:

- The refresh token is stored only in the local plugin data.
- The token is not uploaded to the remote sync folder and is not written into logs.
- Back up important vaults before first use, and use a dedicated remote folder for each vault.

把当前 Obsidian 知识库直接同步到个人阿里云盘 App 里的指定云端文件夹。

这个项目不是把 vault 同步到本地阿里云盘客户端目录，而是通过阿里云盘开放接口读写云端文件。多台设备安装同一个插件、使用同一个阿里云盘账号，并配置同一个云端目录后，可以自动上传本地变更，也可以拉取另一台设备已经同步到云端的更新。

## 背景

阿里云盘个人开发者应用申请已经暂停，自建 OAuth 应用这条路对个人用户不稳定。因此当前版本采用 OpenList refresh_token 模式：

1. 通过 OpenList Token 获取工具扫码授权个人阿里云盘。
2. 把 `refresh_token` 填入插件设置页。
3. 插件通过可配置的 OpenList 续期接口换取访问令牌。
4. 后续文件同步仍然走阿里云盘开放接口。

`refresh_token` 等同于长期登录凭证。插件只保存到本地 Obsidian 插件数据中，不会写入云端元数据，也不会写入日志。安全要求更高时，建议自建 OpenList APIPages 续期接口。

## 核心功能

- 双向同步：把当前 Obsidian vault 同步到阿里云盘指定云端文件夹。
- 多设备同步：另一台设备安装插件并配置同一云端目录后，可以拉取已上传的更新。
- 增量同步：基于本地状态、云端状态和同步历史生成计划，不会每次从头传输。
- 内容校验：使用 SHA-1 内容 hash 判断文件是否真正变化，减少仅靠时间戳导致的误判。
- 自动同步：支持启动后延迟同步、定时同步、保存后延迟同步，也支持手动立即同步。
- 进度显示：状态栏显示扫描、规划、上传、下载等大体进度和当前文件。
- 并行传输：支持配置并行上传/下载数量，遇到限流或网络波动会自动降并发重试。
- 冲突处理：Markdown 文件可尝试三方合并；无法安全处理的冲突会保留到插件内部冲突目录。
- 删除保护：支持删除同步，但会按最大删除数量和删除比例拦截异常的大规模删除。
- 防重复目录：修复并行上传时云盘自动生成 `文件夹(1)`、`文件夹(2)` 的问题；历史上已经产生的自动重名副本也会被识别并跳过，避免再次拉回本地或继续上传。
- Obsidian 集成：提供设置页、状态栏进度和左侧栏手动同步图标。

## 安装

在项目根目录构建：

```bash
npm install
npm run build
```

把以下文件复制到你的 vault 插件目录：

```text
<你的 vault>/.obsidian/plugins/aliyun-drive-sync/
  main.js
  manifest.json
  styles.css
```

然后在 Obsidian 中启用 `Aliyun Drive Sync`。

## 首次使用

1. 打开 [OpenList Token 获取工具](https://api.oplist.org/)。
2. 选择 `阿里云盘（OAuth2）扫码登录`。
3. 勾选 `使用 OpenList 提供的参数`。
4. 扫码授权后复制 `Refresh Token`。
5. 在插件设置页粘贴到 `阿里云盘 Open refresh_token`。
6. 设置云端同步文件夹，例如：

```text
/Apps/ObsidianSync/MyVault
```

7. 点击 `连接`，再点击 `测试连接`。
8. 首次同步前建议备份本地 vault，然后点击 `立即同步`。

多台设备需要填写同一个云端同步文件夹。每个不同 vault 建议使用不同云端目录。

## 同步策略

插件每轮同步会扫描本地和云端文件列表，然后结合本地同步历史生成计划：

- 本地新增或修改：上传到云端。
- 云端新增或修改：下载到本地。
- 两边都没变：跳过。
- 两边内容相同但缺少历史记录：建立同步基准，不重复上传或下载。
- 两边都修改了同一个 Markdown：尝试合并。
- 无法安全判断：保留冲突副本到 `.obsidian-aliyun-sync/conflicts/`。

首次遇到本地和云端同路径文件时，默认策略是“以较新文件为准”。如果两边大小一致但缺少可比较的 SHA-1 hash，会先记录同步基准，减少无意义上传或下载。

## 并行与重复目录保护

早期版本在并行上传时，多个文件可能同时尝试创建同一个云端父目录；如果云端接口使用自动重命名，就会生成 `00_Inbox(1)`、`mental-models(2)` 这类真实目录。

当前版本已经做了两层保护：

- 同一个云端目录路径只允许一个创建任务执行，其它并行任务会复用同一个结果。
- 创建目录时使用拒绝重名策略，不接受云盘自动改名。
- 扫描云端和本地时，如果同层已经存在原名，`xxx(1)`、`xxx(2)`、`xxx(1).md`、`(1).obsidian` 会被视为自动重名副本并跳过。

如果你从旧版本升级，并且云端或本地已经存在这些重复目录，建议先确认里面没有独有内容，再手动清理云端重复目录；本地重复目录也可以清理后重新同步。

## 推荐设置

```text
云端同步文件夹: /Apps/ObsidianSync/<你的 vault 名称>
启动后自动检查: 关闭
启动后同步延迟: 1 秒
定时同步间隔: 0 分钟
保存后同步延迟: 1 秒
并行传输数量: 3
最大删除数量: 20
最大删除比例: 30
同步 .obsidian: 先关闭，确认稳定后再按需开启
```

如果出现 429、403、Too Many Requests、上传分片失败或下载失败，建议把并行传输数量降到 `2` 或 `1` 后重试。

## 使用建议

- 首次同步前先备份本地 vault。
- 每个 vault 使用独立云端目录，避免多个知识库互相污染。
- 如果准备清空云端重新测试，请先清空插件同步历史，但保留连接配置，避免把“云端为空”误判为云端删除。
- 不建议一开始就同步完整 `.obsidian`，尤其是缓存、索引和第三方插件大文件。默认设置已经排除部分高风险路径。
- 多设备同时使用时，尽量避免两台设备长期离线后同时修改同一个大文件。

## 开发

常用命令：

```bash
npm run test
npm run build
npm audit --omit=dev
```

当前测试覆盖同步计划、冲突处理、删除保护、进度显示、设置迁移、OpenList 续期参数、执行器并发/失败跳过、SHA-1 内容判断和自动重名副本识别。

## 文档

- [插件架构与实现方案](docs/plugin-design.md)
- [使用指南手册](docs/user-guide.md)

## 当前状态

当前版本是个人使用场景下的 MVP，已经具备基础双向同步、多设备同步、增量同步、进度反馈、并行传输、冲突处理、删除保护和重复目录防护能力。

它仍建议在重要知识库上使用前先备份，并先用独立云端目录做小规模测试。
