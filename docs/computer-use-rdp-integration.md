# 本机 RDP 后端的 Faber 打包接入

状态：2026-11-09，打包链路准备完成；组件依赖仍固定已发布的 0.8.1，尚未部署周末的新后端。

- Computer Use 包可以额外携带唯一的 Windows x64 `computer-use-rdp.dll`，并必须同时携带 FreeRDP、OpenSSL、zlib 三份许可证。其他 DLL、错误架构、EXE 伪装 DLL、源码及调试文件仍拒绝。
- Windows 构建把审核过的 DLL 放入生成目录 `apps/desktop/resources/computer-use/`，通过 Windows Tauri resources map 安装到应用目录，与 helper EXE 相邻，符合原生绝对路径加载要求。旧包没有 RDP 时保持兼容，输出运行时清单且清除生成目录中的旧 DLL。
- 许可证进入已有 notices 链路。可选独立服务归档也复制对应 DLL；归档前检查运行时存在，防止只携带 EXE。
- 组件自身负责 RDP ABI、静态链接、生产/测试导出隔离与原生行为；Faber 只负责组件依赖及资源封装，不新增第二套桌面执行器。

本地验证覆盖：新包完整闭包、DLL 字节一致性、许可证缺失、额外 DLL、错误 CPU、EXE 伪装、旧包与过期 DLL 清理。Faber 完整回归 125 项通过。实际 Windows 安装路径与 DLL 加载仍需 Windows 构建及交互式桌面验收；当前机器不执行 Windows GUI。

后续顺序：组件三平台 CI → Mac 复杂交互验收 → Windows 交互式验收 → 发布新组件并同步精确依赖/lock/guard → Faber 三平台安装与更新校验。不得复用已发布版本号覆盖新二进制。

2026-11-09 实际产物验证：Computer Use 验证运行 [42570722247](https://github.com/HideInMatrix/computer-use/actions/runs/42570722247) 的三平台原生、打包、三平台安装 job 均成功。下载并校验该运行的组件 artifact 后，用本仓库的 `assertComputerUsePackage` / `prepareComputerUseRuntime` 在隔离目录处理真实包，7,802,368 字节生产 DLL 的输出与原件逐字节一致；FreeRDP/OpenSSL/zlib 许可证齐全，runtime manifest 正确。DLL SHA-256：`a5af7449c1a929b30d2545d3ed33e02710a9c0e8aa5e05539bfd1b5808d63215`。这是组件与资源封装验证，未执行 Faber Windows 安装器或 Windows GUI，未切换当前依赖。
