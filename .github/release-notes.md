# Faber v1.4.1

## 更新内容

- Computer Use 升级至 0.5.2，同步更新 macOS ARM64、macOS x64 和 Windows x64 原生助手，以及依赖锁文件和发行包校验。
- 集成该版本的浏览器 DOM 操作反馈、可见的验证与结果状态、macOS/浏览器结果显示时长调整，以及 macOS 局部像素新鲜度检查。
- 保持现有 11 个 MCP 工具和原生协议 3，沿用 Faber 的审批流程、系统权限及原生助手签名身份。

## 验证

- 类型检查、前端与服务构建、包来源及发行边界校验通过；115 项本地测试通过，依赖安全审计为 0 漏洞。
- JS/MCP 集成验证通过，覆盖 JSON 文档观察、只读约束、QuickJS 批处理运行时和 Playwright 资源加载；自动化测试仅保留本地。
- 本机 macOS 原生助手经标准私有 IPC 握手验证为组件 0.5.2、协议 3，并包含 control_feedback_v2、pointer_region_guard_v1；未执行桌面输入或请求系统权限。
- 三平台安装包与发行签名由版本标签 CI 构建和验证，Windows 及 macOS x64 未进行本地实机操作验证。

## 兼容与安装

- 保持应用配置、Bundle ID 和更新签名兼容，继续使用内置 cloudflared 2026.10.7 及其独立更新入口。
- macOS 主应用要求 macOS 13 或更高版本；Windows 仅支持 x64。
- macOS 使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。
- Release 提供桌面安装包、更新归档、更新清单和校验文件。
