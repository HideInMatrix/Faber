# Desktop 构建优化

## 已落地

### Rust 与 CI 缓存

- `apps/desktop/Cargo.toml` 的桌面 library 仅生成 `rlib`；不再附带当前未使用的移动端 `staticlib` / `cdylib`。
- release profile：`opt-level = 2`、`lto = "off"`、`codegen-units = 16`、`strip = "symbols"`。不改 panic/unwind、overflow 或安全校验语义；这些参数不影响 Node 业务代码。
- `NO_STRIP=true` 仍保留，避免 Tauri 对注入 SEA 的 Node 和 helper 通用 strip；Rust 符号在 Rust 自身构建阶段单独处理。
- `master` 的相关源码 push **只运行 Ubuntu 上的类型检查、前端构建和依赖漏洞检查**；不启动 macOS / Windows 原生 job，不构建 SEA / Rust，不上传打包资源，不需要签名私钥。
- 版本 tag 才自动启动三平台 SEA / Rust、签名、安装包和 Release 发布。一次推送 master 与 tag 仍会出现两条 workflow 记录，但只有 tag 那条会三平台打包，master 那条仅检查源码。
- 删除 verify job 中无人复用的 service bundle；服务只在各原生 job 的 `build:sidecar` 内构建。经过验证的前端仅在需要原生构建时上传，各平台共用一次前端产物。
- 保留读取已有 Rust 依赖缓存，不再为每次 master push 自动做三平台编译来预热。路径布局、平台隔离、固定 Rust 版本及安全校验保留；没有可用缓存时直接正常编译，**发布前无需等待或运行预热**。
- `workflow_dispatch` 默认完整构建安装包但不发布。只有主动勾选 `warm_cache` 才执行三平台 `--no-bundle` 编译并保存默认分支依赖缓存；此模式仅允许选择 master，不能同时勾选 `standalone_service`，不需要 updater 私钥，不生成/上传安装包。它仍消耗三平台编译时间，只适合明确需要更新共享缓存时使用，不是发布前置步骤。
- 缓存写入仅限手动预热，且不保存失败构建的缓存。tag / 普通手动打包只读取已有缓存；不同 tag 的缓存不能作为跨版本共享缓存使用。公开发布仍仅由版本 tag 触发，且必须全部平台成功。

### 服务与资源体积

- esbuild 默认 minify，`keepNames=true` 保留 upstream function/class names，以减少反射/诊断兼容风险。诊断可设置 `MICROMATRIX_SERVICE_MINIFY=0` 对比；它是构建参数，不是运行时开关。
- installer `DEPENDENCIES.json` 升级 schema 2，去掉重复的正文；完整许可证只放 `DEPENDENCY_LICENSES.txt`。JSON 保留原文件名、来源、license、review warning、SHA-256，并记录正文的 UTF-8 字节区间。前端 Vite 证明文件不变，native job 仍收到完整文本。
- 不删除 Node、Pi、Playwright、cloudflared、Rust 标准库及原生辅助组件或任何要求保留的 LICENSE / NOTICE。
- 仅剔除 Playwright 非运行时 TypeScript/source map，保留功能 JS 及许可资源；不删除 cloudflared、不改变私有依赖的预编译原生辅助程序，也不使用跨平台 SEA。

### 避免重复压缩与传输

- 默认 `package-artifacts.mjs` 只生成 `dist/artifacts` 的安装包、签名更新包、通知、元数据和校验和。
- 仅 `MICROMATRIX_PACKAGE_STANDALONE_SERVICE=1` 时生成独立服务 archive，放入 `dist/internal-artifacts`，有独立 SHA-256 文件；不混入公开发布的下载集合。
- GitHub 手动运行时勾选 `standalone_service` 才生成/上传 `internal-service-*`，保留 7 天。公开发布下载仍只匹配 `micromatrix-*`。
- 重打包会清理旧的内部 archive 与 service staging，避免历史产物意外进入下一次打包。
- macOS `.app.tar.gz` 是 updater 必需，不是可以删掉的多余 DMG 副本。Windows EXE / MSI 的更新类型与签名保留。

## 本机测量（2026-10-10，ARM64，Rust 1.98.1）

同一机器，先编译依赖，再用 `cargo clean --release -p micromatrix-pi-mcp` 仅清理本项目，比较完整 release host 重编。包含 build script、项目代码和链接；不是 GitHub runner 的 wall-clock 保证，单次测量也存在噪声。

| 项目 | 原配置 | 新配置 |
|---|---:|---:|
| 缓存依赖后的 Rust host 重编 | 18.78 秒 | 14.49 秒（约 -23%） |
| 仅精简 crate-type 的中间对比 | 18.78 秒 | 17.51 秒 |
| Rust host 文件 | 17,240,928 bytes | 12,555,904 bytes（约 -27%） |
| Node JS bundle，raw | 16,558,574 bytes | 9,766,044 bytes（约 -41%） |
| Node JS bundle，gzip | 3,313,191 bytes | 2,667,502 bytes（约 -19%） |
| 437 个依赖的 notice JSON | 3,397,082 bytes | 274,612 bytes（约 -92%） |

JS 数据为相同应用内容的非 minify / minify 对比；gzip 使用 Node 默认压缩参数，不代表 DMG/NSIS 的精确节省量。notice JSON 只移除重复正文，678 个完整 notice 文本的字节区间均回算 SHA-256 一致。缓存命中是否节省 CI 时间要看线上日志，不以额外自动全量构建换取预热；本机结果不换算为“发布一定几分钟”。

同版本 Node 22.23.3 的本地 ARM64 开发签名包：DMG 74,624,088 bytes（71.2 MiB），updater archive 68,648,244 bytes（65.5 MiB）。DMG checksum、`.app` deep/strict codesign、实际 updater 的固定公钥/签名版本校验及默认 artifact 校验和通过。仅作本地构建结果，不替代正式签名 CI、Intel / Windows 的最终体积测量。

## 复测

```sh
npm run check
npm run build:sidecar -- --prebuilt-web
node scripts/dependency-notices.mjs --strict
cargo build --manifest-path apps/desktop/Cargo.toml --locked --offline \
  --release --bins --features tauri/custom-protocol --timings
```

对比原编译参数可通过环境覆盖，不改 Cargo.lock / 依赖版本：

```sh
CARGO_PROFILE_RELEASE_OPT_LEVEL=3 CARGO_PROFILE_RELEASE_LTO=false \
CARGO_PROFILE_RELEASE_STRIP=none cargo build \
  --manifest-path apps/desktop/Cargo.toml --locked --offline \
  --release --bins --features tauri/custom-protocol --timings
```

profile 变化会使相关 crates 首次重编；比较 warm rebuild 时需先完成各自依赖构建，再单独清理项目输出。每个平台分别看 `rust-timings-*`、cache hit / save 日志、Rust 编译与安装包压缩时间，不拿 Artifact 合计体积当单个安装包体积。

本轮用 CI 同版本 Node 22.23.3 做临时回归，覆盖 CJS / 无 node_modules 的隔离 SEA / 真实 Tauri `.app` 内的 SEA：MCP 9 tools、JSON 观察/修改、只读门禁、敏感字段脱敏、陈旧 observation 拒绝、嵌入 QuickJS 隔离、Playwright 惰性加载、控制面/静态前端、默认不启动 Runtime 和 Origin 拒绝；打包覆盖默认/opt-in、旧 archive 清理、校验和与 updater 签名/签名版本篡改拒绝。ARM64 的本地开发签名 `.app` 与 updater archive 打包及 codesign deep/strict 检查通过；它不是正式长期证书的发布产物。测试 fixture 不进入项目或安装包。Intel / Windows 的完整原生构建和真实 GUI/TCC/更新安装验收仍需各自平台，不能由本机 ARM64 结果代替。

## 本轮不做

不直接上 fat LTO、codegen-units=1、panic=abort，不强行把 `-j` 调到超过 runner 实际算力，不引入 sccache / 新 linker / 自托管 runner，不改长期代码签名身份与 updater 公钥。这些需要后续独立测量和兼容性验收。
