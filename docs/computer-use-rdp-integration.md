# 本机 RDP 后端的 Faber 打包接入

状态：2026-11-09，发布配置升级至 Computer Use 0.9.0 / Faber 1.8.0，沿用已完成的 DLL 与许可证封装链路；组件 0.9.0 已通过发布及三平台 registry 安装复核，依赖/lock/guard 已同步；Faber 三平台安装包与更新仍由标签 CI 验证。

- Computer Use 包可以额外携带唯一的 Windows x64 `computer-use-rdp.dll`，并必须同时携带 FreeRDP、OpenSSL、zlib 三份许可证。其他 DLL、错误架构、EXE 伪装 DLL、源码及调试文件仍拒绝。
- Windows 构建把审核过的 DLL 放入生成目录 `apps/desktop/resources/computer-use/`，通过 Windows Tauri resources map 安装到应用目录，与 helper EXE 相邻，符合原生绝对路径加载要求。旧包没有 RDP 时保持兼容，输出运行时清单且清除生成目录中的旧 DLL。
- 许可证进入已有 notices 链路。可选独立服务归档也复制对应 DLL；归档前检查运行时存在，防止只携带 EXE。
- 组件自身负责 RDP ABI、静态链接、生产/测试导出隔离与原生行为；Faber 只负责组件依赖及资源封装，不新增第二套桌面执行器。

本地验证覆盖：新包完整闭包、DLL 字节一致性、许可证缺失、额外 DLL、错误 CPU、EXE 伪装、旧包与过期 DLL 清理。Faber 完整回归 125 项通过。实际 Windows 安装路径与 DLL 加载仍需 Windows 构建及交互式桌面验收；当前机器不执行 Windows GUI。

后续顺序：组件三平台 CI → Mac 复杂交互验收 → Windows 交互式验收 → 发布新组件并同步精确依赖/lock/guard → Faber 三平台安装与更新校验。不得复用已发布版本号覆盖新二进制。

2026-11-09 实际产物验证：Computer Use 验证运行 [42570722247](https://github.com/HideInMatrix/computer-use/actions/runs/42570722247) 的三平台原生、打包、三平台安装 job 均成功。下载并校验该运行的组件 artifact 后，用本仓库的 `assertComputerUsePackage` / `prepareComputerUseRuntime` 在隔离目录处理真实包，7,802,368 字节生产 DLL 的输出与原件逐字节一致；FreeRDP/OpenSSL/zlib 许可证齐全，runtime manifest 正确。DLL SHA-256：`a5af7449c1a929b30d2545d3ed33e02710a9c0e8aa5e05539bfd1b5808d63215`。这是组件与资源封装验证，未执行 Faber Windows 安装器或 Windows GUI，未切换当前依赖。

本轮保留 Windows/Intel 真实 GUI 未验收及 Blender 恢复中文输入法后 B 快捷键的兼容性限制；Mac 内置菜单路线的完整弹窗/框选/拖拽验收通过。详见 release-1.8.0.md，不将 CI 安装或签名校验当作实机验收。

本轮用户明确在知晓 Windows/Intel GUI 缺项及 Blender B 快捷键限制后恢复发布；Windows 交互式验收仍待后续，不记录为通过。0.9.0 实际 registry 包的 RDP DLL 在隔离目录封装后与原件逐字节一致，大小 7802368，SHA-256 `e428c1025d9008719416abcb462e094fbfc61b1a3c7d854c9d5f28f984a559c0`，三份许可证齐全，运行时清单为 0.9.0，临时目录已清理。组件发布 CI：42637285369；registry 字节及三平台复核 CI：42641466414。
