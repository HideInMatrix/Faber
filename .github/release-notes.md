# Faber v1.2.1

## 更新内容

- 打包内置的 Cloudflare Tunnel 客户端（cloudflared）从 2026.9.3 更新至 2026.10.2。
- 同步固定 macOS Apple Silicon、macOS Intel 和 Windows x64 的 SHA-256，继续在打包时严格校验下载文件。
- macOS 校验值采用实际下载文件与官方 GitHub 资产摘要一致的值，避免发布说明中的旧校验值导致构建失败。
- 不修改已保存的 Runtime 配置、端口、审批逻辑及应用更新签名身份。

## 验证

- 三平台官方文件 SHA-256 校验通过，篡改文件拒绝校验通过。
- 本机 macOS Apple Silicon 的 cloudflared 2026.10.2 版本执行验证通过。
- TypeScript / Vue 类型检查、前端构建及项目回归通过；三平台安装包由标签 CI 构建与验证。

## 兼容与安装

- 保持应用配置、Bundle ID 和更新签名的兼容性。
- macOS 主应用要求 macOS 13 或更高版本；Windows 仅支持 x64。
- macOS 使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。
- Release 提供桌面安装包、更新归档、更新清单和校验文件。
