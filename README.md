# DeskResearch

DeskResearch 是一个本地优先的 macOS 办公调研 Agent。输入任意研究主题后，它会搜索公开网页、让用户确认候选来源、保留逐条引用与失败状态，并生成 Excel 证据底稿、Markdown 报告和 JSON 证据。用户还可以配置采用 OpenAI Chat Completions 格式的模型接口，生成受证据约束的语义总结。

## 研究流程

1. 输入研究主题或需要比较的产品。
2. Agent 将精简后的关键词发送给 Bing，查找公开候选来源。
3. 用户取消不可信或无关网站，只授权访问勾选页面。
4. Agent 提取带 `[S1]`、`[S2]` 引用的网页原文，并提示跨来源的潜在词面冲突。
5. 若已配置模型，Agent 只把已抽取证据交给模型，并丢弃没有有效证据编号的模型结论。
6. 生成语义总结、证据结论、来源、潜在冲突工作表和带来源目录的研究报告；未配置模型时自动回退为原文证据摘要。

冲突提示用于提醒人工复核，不代表系统已经完成事实裁决。

## 直接下载

当前尚未上传 GitHub。可直接使用本项目本地生成的 `release/DeskResearch-0.1.0-mac-arm64.zip`，解压后将 `DeskResearch.app` 拖入“应用程序”。

当前下载版要求：

- Apple Silicon Mac。
- macOS 13 或更高版本。
- 已安装 Google Chrome、Microsoft Edge 或 Chromium。
- 可以访问配置中的公开网站。

当前版本使用临时本地签名，尚未经过 Apple 公证。首次打开时，macOS 可能要求用户在 Finder 中右键应用并选择“打开”。

任务成果保存在：

```text
~/Documents/DeskResearch/outputs/
```

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run desktop
```

点击左下角设置按钮可填写 `Base URL`、模型名和 `API Key`。API Key 经 Electron `safeStorage` 加密后保存在应用数据目录，macOS 下密钥由系统钥匙串保护；渲染页面只能获知“是否已配置”，不能读回密钥。

运行浏览器采集与产物测试：

```bash
npm run poc
```

构建 Apple Silicon 应用：

```bash
npm run package:mac
```

生成适合上传到 GitHub Release 的 ZIP：

```bash
npm run release:zip
```

构建结果位于：

```text
release/mac-arm64/DeskResearch.app
release/DeskResearch-0.1.0-mac-arm64.zip
```

## 安全边界

- 搜索候选公开页面，并且只访问用户在来源确认窗口中勾选的 URL。
- 不读取浏览历史、现有登录状态或 Cookie。
- 不自动提交表单、购买或发送消息。
- 不控制 Pages、Numbers、Excel、Word 等原生应用。
- 文件只保存在本地任务目录。
- API Key 不写入项目、成果文件或渲染页面；仅在任务运行时传给本地子进程。

## 项目结构

```text
desktop/        Electron 主进程、预加载脚本和界面
src/            浏览器采集、证据分析和成果生成
config/         官方来源配置
build/          应用图标
scripts/        发布打包脚本
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run desktop` | 启动桌面应用 |
| `npm run desktop:smoke` | 检查桌面安全桥接和关键界面 |
| `npm run poc` | 验证采集、引用校验并生成成果 |
| `npm run package:mac` | 构建并临时签名 `.app` |
| `npm run release:zip` | 生成 GitHub Release ZIP |

## 当前状态

版本 `0.1.0` 已在 Apple Silicon Mac 上完成安装版验证：4 个产品、9 个官方页面、失败来源 0。正式公开分发仍建议使用 Apple Developer ID 签名并完成公证。
