# 构建与发行校验

本文说明当前打包入口，不保留旧版本耗时、体积或已移除的 CI 预热方案。具体依赖和参数以 `package.json`、`apps/desktop/Cargo.toml` 与 `.github/workflows/desktop.yml` 为准。

## 本地检查与构建

使用项目支持的 Node.js 版本，并先配置 GitHub Packages 的只读认证，再安装 lockfile 中的固定依赖：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build:service
```

`npm run check` 包含 TypeScript / Vue 类型检查、前端构建、源码边界和分发边界校验，不依赖被 Git 忽略的本地测试。`npm run tauri:build` 另需本机 Rust 工具链和更新签名配置，会准备原生资源、构建 Node SEA，再生成 Tauri 安装包。各平台使用本机架构构建，不能把另一平台的 SEA 混入安装包。

## CI 与发布

- 当前 workflow 仅由 `v*` 标签 push 触发；先验证仓库、操作者、SemVer 标签及其与 `master` 的关系，再使用发行凭据。没有 master push 构建或手动预热入口。
- Ubuntu 完成来源校验、类型检查、前端构建、分发校验和依赖漏洞检查。macOS ARM64、macOS Intel、Windows x64 使用共享前端产物，分别构建原生资源和安装包。
- Rust 缓存只恢复、不写入（`save-if: false`）；私有 npm 包不进入可复用公共缓存。release profile 保持 `opt-level = 2`、`lto = "off"`、`codegen-units = 16`，仅剥离 Rust 符号，不对 SEA 或 helper 通用 strip。
- CI 需要只读 `COMPUTER_USE_PACKAGES_TOKEN`、Tauri 更新签名及固定 macOS 证书配置；证书身份与指纹、私钥密码等按 workflow 配置，不能提交到仓库。
- 三平台全部成功后，校验签名、版本及校验和，再生成 `latest.json` 并发布。macOS 更新归档不是多余的安装包副本；不能为减小体积而删除。

## 必须保留的文件

- `scripts/verify-*.mjs`、`scripts/distribution-privacy.mjs`、包来源与资源准备脚本：负责版本、来源、架构、签名和源码泄漏边界。
- `.github/workflows/desktop.yml`、打包/发布脚本及 Tauri 配置：负责三平台构建和发行流程；清理说明文档不等于删除这些入口。
- `.github/release-notes.md`：发布脚本、更新清单和桌面通知资源的实际输入，不能作为重复文档删除。
- 根 `README.md`、`third_party/` 的 LICENSE / NOTICE、依赖通知清单及生成的 notices 资源：部分会进入安装包或可选独立服务归档，不能按文件扩展名批量清除。
- `diagnostics/diagnose-windows-freeze.ps1`：手动采样工具，保留；旧事故说明的删除不表示事故已定位或修复。

对外更新说明仅描述功能与修复，不记录 Computer Use 的内部实现及内部验证过程。
