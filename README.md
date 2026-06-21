# Obsidian Aliyun Drive Sync

把 Obsidian 知识库同步到个人阿里云盘 App 里的指定云端文件夹。

这个项目的目标不是同步到本地阿里云盘客户端目录，而是直接通过阿里云盘 Open API，把当前 vault 和云端文件夹做双向同步。多台设备安装同一个插件、使用同一个阿里云盘账号并配置同一个云端目录后，可以自动上传本地变更，也可以拉取另一台设备已经同步到云端的更新。

## 背景

阿里云盘个人开发者申请已经暂停，自建 OAuth 应用这条路对个人用户不稳定。因此当前版本采用 OpenList refresh_token 模式：

1. 通过 OpenList Token 获取工具扫码授权个人阿里云盘。
2. 把 `refresh_token` 填入插件设置页。
3. 插件通过可配置的 OpenList 续期接口换取访问令牌。
4. 后续文件同步仍然走阿里云盘 Open API。

`refresh_token` 等同于长期登录凭证。插件只保存到本地 Obsidian 插件数据中，不会写入云端元数据，也不会写入日志。更高安全要求下，建议自建 OpenList APIPages 续期接口。

## 主要功能

- 同步当前 Obsidian vault 到阿里云盘云端文件夹。
- 支持手动同步、启动后自动同步、定时同步、保存后延迟同步。
- 支持增量同步：基于本地状态、云端状态和本地同步历史生成同步计划。
- 使用 SHA-1 内容 hash 判断文件内容，减少仅靠时间戳导致的误判。
- 支持并行上传/下载，并在限流或网络波动时自动降并发重试。
- 支持删除同步保护，避免误删或误配目录导致大面积删除。
- 支持 Markdown 冲突合并；无法安全处理的冲突会保存到插件内部目录，不污染正常笔记目录。
- 提供状态栏同步进度和左侧栏手动同步图标。

## 安装

在项目根目录构建：

```bash
npm install
npm run build
```

把以下文件复制到你的 vault 插件目录：

```text
<你的 vault>/.obsidian/plugins/obsidian-aliyun-sync/
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

插件每轮同步会扫描本地和云端文件列表，然后结合本地同步日志生成计划：

- 本地新增或修改：上传到云端。
- 云端新增或修改：下载到本地。
- 两边都没变：跳过。
- 两边都改了同一个 Markdown：尝试合并。
- 无法安全判断：保留冲突副本到 `.obsidian-aliyun-sync/conflicts/`。

首次遇到本地和云端同路径文件时，默认策略是“以较新文件为准”。如果两边大小一致但缺少可比较的 SHA-1 hash，会先记录同步基准，减少无意义上传或下载。

## 推荐设置

```text
云端同步文件夹: /Apps/ObsidianSync/<你的 vault 名称>
启动后自动检查: 开启
启动后同步延迟: 10 秒
定时同步间隔: 10 分钟
保存后同步延迟: 20 秒
并行传输数量: 3
最大删除数量: 20
最大删除比例: 30
同步 .obsidian: 先关闭
```

如果出现 429、403、Too Many Requests、上传分片失败或下载失败，建议把并行传输数量降到 `2` 或 `1` 后重试。

## 开发

常用命令：

```bash
npm run test
npm run build
npm audit --omit=dev
```

当前测试覆盖同步计划、冲突处理、删除保护、进度显示、设置迁移、OpenList 续期参数和执行器并发/失败跳过逻辑。

## 文档

- [插件架构与实现方案](docs/plugin-design.md)
- [使用指南手册](docs/user-guide.md)

## 状态

当前版本是个人使用场景下的 MVP。它已经具备基本双向同步能力，但仍建议在重要知识库上使用前先备份，并先用独立云端目录做小规模测试。
