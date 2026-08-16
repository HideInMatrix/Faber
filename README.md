# Faber

Faber，取自拉丁文“工匠”。让 AI 不止于对话，而是完成实际工作。

## 用途

让网页 AI 通过 MCP 调用本地工具：**网页 AI 负责思考，Pi Agent 负责本地执行。** 本软件不运行本地模型。

- **文件与命令**：读写工作目录内的文件，按权限策略执行 Shell 命令。
- **能力扩展**：添加 MCP 服务和 Skills，接入 Pi 插件体系。
- **公网连接**：通过 Cloudflare Tunnel 等网络方案连接网页 MCP 客户端，并提供 OAuth 认证和工具审批。

打开软件只加载配置；点击「启动」后才运行 MCP 和隧道。

## 安装

前往 [GitHub Releases](https://github.com/HideInMatrix/micromatrix-workbench/releases/latest)，下载适合自己电脑的**安装包**：

| 平台 | 下载与安装 |
| --- | --- |
| macOS · Apple Silicon（M 系列） | 下载 `aarch64.dmg`，打开后将应用拖入「应用程序」 |
| macOS · Intel | 下载 `x64.dmg`，打开后将应用拖入「应用程序」 |
| Windows · x64 | 下载 `*-setup.exe` 或 `.msi`，运行安装程序 |

无需另装 Node.js、Rust 或 Python；Cloudflare 客户端已内置。Linux 桌面版暂不支持。

首次使用：

1. 打开应用，配置工作目录、OAuth 密码和网络方案，保存后点击「启动」。
2. 将显示的 MCP 地址添加到支持 CIMD OAuth 的网页 MCP 客户端，完成授权。

macOS 安装包使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。若系统阻止打开，请先确认下载来源，再按系统提示允许运行。

应用会自动检查更新，确认安装在「关于」页面操作。`.app.tar.gz`、`latest.json` 和校验文件用于更新或校验，不是首次安装入口。

## 开源鸣谢

- [Pi Agent](https://github.com/earendil-works/pi)
