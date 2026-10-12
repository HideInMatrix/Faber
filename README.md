# Faber

[English](README.en.md) · 简体中文

Faber，取自拉丁文“工匠”。让 AI 不止于对话，而是完成实际工作。

## 用途

让网页 AI 通过 MCP 调用本地工具：**网页 AI 负责思考，Pi Agent 负责本地执行。** 本软件不运行本地模型。

- **文件与命令**：读写工作目录内的文件，按权限策略执行 Shell 命令。
- **能力扩展**：添加 MCP 服务和 Skills，接入 Pi 插件体系。
- **公网连接**：通过 Cloudflare Tunnel 等网络方案连接网页 MCP 客户端，并提供 OAuth 认证和工具审批。

打开软件只加载配置；点击「启动」后才运行 MCP 和隧道。

## 功能特色

- **网页 AI，本地执行**：通过 MCP 将网页 AI 的推理能力与本地文件、命令和工具连接起来，无需部署本地模型。
- **Computer Use 电脑控制**：内置桌面与浏览器操作能力，在启用功能并授予所需系统权限后，让 AI 操作电脑。
- **灵活扩展能力**：管理 MCP 服务、Skills 和 Pi 插件，为不同任务组合所需工具。
- **多种连接方案**：支持 Cloudflare Tunnel、外部地址等网络方案，通过 OAuth 授权连接兼容的网页 MCP 客户端。
- **操作权限可控**：按需选择逐次审批、自动批准文件修改或完全访问模式；启动、停止由用户控制，并可查看运行状态和日志。
- **开箱即用，双语界面**：提供 macOS 与 Windows 安装包，内置运行依赖；支持中英文切换、自动检查更新和手动确认安装。

## 安装

前往 [GitHub Releases](https://github.com/HideInMatrix/Faber/releases/latest)，下载适合自己电脑的**安装包**：

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

## Computer Use

让 AI 不只读写文件，还能通过内置 Computer Use 操作桌面与浏览器。

1. 停止 Runtime，在「插件」页面启用 **Computer Use**。
2. macOS 用户点击「设置权限」，按提示授予辅助功能和屏幕录制权限，再点击「重新检测」确认状态；Windows 用户需在可交互的桌面会话中使用。
3. 如需浏览器通道，展开「浏览器连接」，填写已开启调试的独立 Chromium 浏览器的本地连接地址和允许的网站，再保存配置。保存不会自动启动浏览器。
4. 启动 Runtime 后，通过已授权的 MCP 客户端调用相关工具；控制动作受当前权限审批策略约束。

启用 Computer Use 不会自动启动 Runtime 或隧道。修改开关或浏览器配置前，需要先停止 Runtime。

## 界面语言

默认使用中文。在侧边栏菜单下方的「界面语言」下拉框中选择 `English`，即可切换英文界面；选择会在本机记住。切换语言不会启动、停止 Runtime，也不会修改工作目录、密钥或权限设置。

语言切换仅影响界面文案；日志输出、第三方返回内容和用户填写的数据保留原文。

## 开源鸣谢

- [Pi Agent](https://github.com/earendil-works/pi)
