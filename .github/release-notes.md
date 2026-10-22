# Faber v1.2.3

## 更新内容

- Computer Use 公开编译包从 `@hideinmatrix/computer-use@0.2.0` 升级并精确锁定到 `0.4.0`。
- 接入新版局部观察、`computer_wait` 与 `computer_batch`，MCP 工具由 9 个增至 11 个，原生协议继续使用 ABI 3。
- 同步包身份、版本、工具数量和只读标记的集成校验，保留三平台 helper 架构、资源、许可证与发行签名检查。
- 包仍从 GitHub Packages 安装，公开包下载需要 registry 认证；桌面用户无需额外安装 npm 依赖。

## 验证

- `npm ci`、完整 `npm run check`、前端与服务打包通过。
- MCP 宿主集成验证通过：11 个工具、ABI 3、JSON 观察、QuickJS 与 Playwright 资源加载；验证过程不执行桌面输入。
- 包来源、编译产物边界、三平台 helper 架构与权限显示回归检查通过，锁文件安全审计为 0 漏洞。
- 三平台桌面安装包及发行签名由版本标签 CI 构建和验证。

## 兼容与安装

- 保持应用配置、Bundle ID 和更新签名的兼容性。
- macOS 主应用要求 macOS 13 或更高版本；Windows 仅支持 x64。
- macOS 使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。
- Release 提供桌面安装包、更新归档、更新清单和校验文件。
