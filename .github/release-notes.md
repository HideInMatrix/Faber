# Faber v1.2.2

## 更新内容

- Vite 升级至 8.3.5，Hono 传递依赖更新至 4.13.13，修复阻断打包的依赖安全审计问题。
- GitHub Actions 仅在推送 `v*` 版本标签时执行桌面检查、打包和发布；普通分支推送、PR 和手动运行不再触发。
- 移除重复 CI 工作流，将旧版发布恢复流程归档，保留版本来源校验、签名验证及高危漏洞审计。
- 打包内置的 Cloudflare Tunnel 客户端（cloudflared）从 2026.9.3 更新至 2026.10.2。
- 同步固定 macOS Apple Silicon、macOS Intel 和 Windows x64 的 SHA-256，继续在打包时严格校验下载文件。
- macOS 校验值采用实际下载文件与官方 GitHub 资产摘要一致的值，避免发布说明中的旧校验值导致构建失败。
- 不修改已保存的 Runtime 配置、端口、审批逻辑及应用更新签名身份。

## 验证

- 更新后的锁文件安全审计为 0 漏洞，发布与分发边界相关回归测试通过。
- 本机完整前端构建因缺少私有依赖 `@hideinmatrix/computer-use` 未完成；完整检查及三平台安装包由标签 CI 安装固定依赖后执行。

## 兼容与安装

- 保持应用配置、Bundle ID 和更新签名的兼容性。
- macOS 主应用要求 macOS 13 或更高版本；Windows 仅支持 x64。
- macOS 使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。
- Release 提供桌面安装包、更新归档、更新清单和校验文件。
