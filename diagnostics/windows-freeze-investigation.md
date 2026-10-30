# Windows 桌面无响应排查

检查对象：Faber v1.2.3，已安装的 `@hideinmatrix/computer-use@0.4.0`，以及独立源仓库 `v0.4.0` 的 Windows helper。检查时独立源仓库的 `native/windows.cs` 与该 tag 无差异。当前检查机为 macOS，没有在反馈的 Windows 电脑复现，以下风险不能直接当作事故根因。

用户最新澄清：没有使用 computer-use 功能。此前“正在让 AI 操作电脑”的回答不能视为执行原生桌面输入的证据。反馈电脑的实际 Faber 版本、最后调用的工具、鼠标移动情况及 Ctrl+Alt+Del 响应尚未确认。

## 本次反馈的排查重点

**目前不能将本次故障归因于下文的 computer-use 输入路径。** Runtime 仅在 computer-use 配置开启时加载它；即使开启，权限检查也不执行截图或输入，原生控制需要相应工具调用。PiBodyHost 是 execution-only 工具宿主，没有本地模型聊天循环，不能直接将问题归为本地 AI 会话历史无限增长。

未使用 computer-use 仍可经过的路径中发现：

- `plugins/shell/src/index.ts` 直接使用 Pi 的 `createBashTool`。当前固定依赖 `@earendil-works/pi-coding-agent@0.87.1` 的 `dist/core/tools/bash.js` 将 timeout 设为可选，并明确没有默认超时。长时间运行命令只有显式 timeout、取消或 Runtime 停止等退出路径；Workbench 没有另外添加 Shell 并发数和资源配额。这是资源耗尽风险，不代表用户实际执行了此类命令。
- 同一依赖的 `dist/core/tools/output-accumulator.js` 将截断后的完整输出写临时文件，`append` 忽略 `WriteStream.write()` 的 false 返回值；上游 stdout/stderr 的 data handler 也没有据此暂停读取。因此显示尾部有界不等于磁盘写入队列有界。
- 已运行有界模拟：对临时文件 writer 执行 cork 模拟暂时不能排空，再提交 128 个 64 KiB 输出块。展示上限为 51200 字节，writer 的 writableLength 达到 8454144 字节，writableNeedDrain=true。随后 uncork、关闭并删除测试文件。该实验确认写入背压下队列可以超过展示上限，未模拟 Windows 全桌面冻结，也未证明真实机器遇到慢磁盘/高输出。

应优先取卡死前实际 Shell/MCP 调用、service 与其子进程资源曲线、磁盘占用和 WebView2/Explorer/DWM 状态。Shell 超时/并发/输出总量限制与背压处理可以作为后续修复方向；在获得调用记录前不把这些风险写成事故根因。

## 新线索：用户的网络兼容启动方式

先阅读用户提供的《Faber网络兼容修改记录.md》，随后收到实际启动脚本、兼容模块和日志。未执行启动命令，没有修改原文件。摘要中的历史接口检查不等同于本次复现。

- 摘要称兼容入口通过 `NODE_OPTIONS=--require=...faber-cimd-proxy.cjs` 预加载 JS，处理公共 DNS、HTTP CONNECT、ChatGPT 元数据请求并追加审计日志。该运行环境与原版不同，应独立检查，但仅凭使用 preload 不能判定脚本有缺陷。
- 必须检查脚本是否保留 AbortSignal/超时、及时销毁 socket、清除 timer、限制重试与缓存、正确委托未匹配请求，以及日志是否同步高频写入或无限增长；这些均是待核实项，不是已发现的脚本实现。
- 宿主的 Pi Shell 环境来自 `getShellEnv()`，其代码展开 `process.env`。因此兼容变量可经 Shell 传到后续 Node 进程，在它们支持并接收 NODE_OPTIONS 时再次加载模块。不能扩展为“所有 MCP 子进程都会继承”：外部 stdio MCP 使用 SDK 环境白名单，默认不包含 NODE_OPTIONS。
- 两条 IP 分流规则通常改变网络出口，不能直接解释整个桌面无响应。摘要确认过 FlClash/核心重启后 7890 未立即恢复，说明存在代理中断，但没有卡死时间点、资源曲线或驱动事件。是否启用 TUN 也未交代。
- 磁盘规则已删除不证明运行中规则已卸载；反过来，残留这两条规则也不证明其造成卡死。无需为了验证这一点反复重启全局代理。
- 可在原版启动与兼容启动间比较同类工作负载、进程资源和日志增长；关闭兼容模块可能令 OAuth 再次失败，该授权失败与桌面卡死应分开计数。

### 实际文件检查结果

- 启动脚本仅有 setlocal、两个进程级环境变量和一次 start；没有循环启动、重启代理、改注册表或关停系统进程的代码。未限制重复启动，但不能由此认定发生了实例堆积。
- 模块匹配 ChatGPT 特定元数据请求；未匹配的 HTTPS 请求委托原始函数。DNS 有单份缓存和 pending 合并，每轮最多两个 curl；curl 连接/总时间限制为 3/5 秒，execFile 外层 6 秒，输出 16 KiB 上限。一个 120 秒 unref 定时器负责刷新。Promise.any 成功后另一查询会继续至成功/失败/超时，不会立刻取消，但有时间界限。
- CONNECT/TLS 建连有 10 秒定时器、完成后清理定时器及 abort listener，失败时 destroy 连接对象；成功后的 HTTPS 响应继续交给原请求与 Faber 处理。保留 TLS 证书校验。不能仅由静态检查保证所有网络竞态均正确。
- 同步 appendFileSync 没有日志轮转是可改进项；但提供的日志只有 21531 字节、328 条，覆盖北京时间 2026-10-29 01:44:45 至 16:33:15，最高每分钟 5 条。没有证据支持此次日志洪泛导致卡死。
- 事件计数：preload_active 4，public_dns_verified 286，public_dns_failed 24，cimd_proxy_request 7，cimd_http_200 4，cimd_http_403 3。双 DNS 查询各自记录结果，因此一次成功旁边出现一次失败或两条成功是正常可能情况，不能直接推断整体解析失败或双实例。
- 模块加载时间（北京时间）：01:44:45、14:16:22、15:15:38、16:29:14。日志没有 PID/退出记录，不能区分重启、其他 Node 子进程加载和同时运行的实例。最后一次启动后 DNS 已成功，但后续未见新的元数据请求；不能把“没有请求”当作服务卡死证据。
- 已用内存替身隔离检查原脚本：并发 DNS 只启动两个任务，成功结果缓存复用，单个 120 秒定时器，普通 HTTPS 不改写，模拟 CONNECT 超时会销毁 pending 请求并只回调一次。没有启动 curl、访问网络或让脚本写文件；不是 Windows 实机长稳测试。

**当前判断：这些文件没有呈现无限重试、快速进程堆积或日志风暴的迹象，兼容模块作为整桌面卡死直接根因的嫌疑降低，但不能完全排除其与代理核心/系统资源的间接关联。** 下一步应取得卡死的北京时间和 Windows 资源/事件记录，不能继续仅凭 OAuth 错误猜测。

原件 SHA-256：

```text
Start-Faber-Network.cmd  4f600635c143c84eda55ba122b7db5c3b06afcf7cf59f174730a0aecc2011e49
faber-cimd-proxy.cjs     d6949831c39c581479432ba00cac2be1d9e77b54a4f0f16c75b52098cc9b2c75
cimd-network.log         1bf7d9e9b6b2fb627621f9a52d1f6cfbf8ec06e36c53bc6965ed5a75380c1ca3
```

## Windows 原始事件日志核验（16:00–16:35）

用户提供卡死说明、System/Application 可读导出和两个 EVTX。使用 python-evtx 0.8.1 在原件副本上解码，核对了原件前后的 SHA-256，没有修改输入文件。解析数据、清单、关键原始 XML 和时间线保存在本地忽略目录 `.local/windows-freeze-20261029/`。System 共 134 条，Application 共 54 条，与可读导出数量一致。

用户已确认：电脑卡住后，手动长按电源键重启。事件 41 记录的异常关机与该操作一致，不能将它当成导致卡死的故障本身。

| 北京时间 | 原始证据 | 解释及边界 |
| --- | --- | --- |
| 16:17:37 | System 10016，DistributedCOM | 重启前最后一条提供的系统事件；COM 权限警告本身不能解释本次卡死。 |
| 约 16:20 | 用户描述 | 估计卡死时刻，没有对应的进程/驱动故障事件。 |
| 16:27:11.006514 | 事件 41 的 PowerButtonTimestamp=134377360310065148，按 FILETIME 解码 | 电源键相关时间；已结合用户确认判断为手动关机阶段，不能当作卡死开始时间。 |
| 16:28:00 | Kernel-General 12 | 操作系统启动。 |
| 16:28:02 | Kernel-Power 41，BugcheckCode=0 | 没有记录蓝屏停止码，不代表排除内核/驱动故障；LongPowerButtonPressDetected=False 也不能覆盖用户已确认的操作事实。 |
| 16:28:07 | EventLog 6008，回溯上次意外关闭时间为 16:14:20 | 与 16:17 系统事件、此前已读取网络日志 16:19:50 的活动及用户估计不一致，保留该差异，不据此锁定卡死时间。 |

在导出的重启前范围内，System 只有 BITS 启动类型变更与 DCOM 警告，Application 只有两条软件保护服务信息事件。未见来源为 Application Error、Application Hang、Windows Error Reporting、Resource-Exhaustion-Detector、WHEA-Logger 的事件，也未见 Faber/ngrok 的崩溃记录。缺少此类记录不证明程序、硬件或驱动绝无问题；这仅是所提供时间窗口内的结果。

尤其注意以下重启后事件：

- CodexSandboxService.OpenAI.Codex 的 1000/1001/1002，原始数据分别是服务运行、收到停止请求和服务已停止，级别均为信息。不能只看事件编号，就当成 Application Error 1000 或 Application Hang 1002。
- QQPCTray 的 SideBySide 组件冲突、Dell 服务配置错误、IntelTACD 文件缺失、WUDFRd 加载警告均在重启后出现，现有证据不能证明它们触发此前卡死。存在内核驱动组件不等于已证实驱动有错。
- Schannel 36876 的 0x80092013 表示证书吊销检查服务不可达。涉及 QQPCTray 和两个 curl 进程，时间为 16:28–16:29，说明重启后仍有网络校验问题，不能据此解释重启前卡死；无需关闭 TLS 校验。

当前结论：确认了“用户观察到卡住，随后手动强制重启”的过程，尚未定位卡住的组件。不能归因于 Faber、兼容脚本或 ngrok，也不能排除它们。新增正式代理支持解决的是联网兼容，不能宣称修复本次冻结。

下一步应在复现前启动资源采集；卡住时记录鼠标与 Ctrl+Alt+Del 是否响应。如果可打开任务管理器，保留 CPU/内存/磁盘及主要占用进程。若再次全机无响应，仅靠重启后的常规事件日志很难锁定根因，应再决定是否安排性能跟踪或转储采集；目前不据这些日志盲改驱动或 COM 权限。

参考：[Microsoft 事件 41 排查](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart)、[DCOM 10016](https://learn.microsoft.com/en-us/troubleshoot/windows-client/application-management/event-10016-logged-when-accessing-dcom)、[0x80092013](https://learn.microsoft.com/en-us/windows/win32/wsw/windows-web-services-return-values)。

## 另行记录：computer-use 路径的代码风险

1. **输入释放依赖执行线程的 finally。** `native/windows.cs` 663–673 行先提交修饰键/鼠标按下，再在点击或拖拽期间执行 `checkFocus` / `checkOwner`。这些检查调用 `AutomationElement.FocusedElement` / `FromPoint` 等同步 UIA。若线程卡在 provider 调用中，finally 暂时不能释放输入。包内 `dist/native-channel.js` 90–94 行超时先关闭 stdin，2 秒后强杀 helper；另有关闭路径在 500ms 后强杀。进程被强制终止时不能依赖 finally 执行。因此存在鼠标或修饰键遗留按下状态的路径，可能表现为点击、快捷键或拖拽异常；尚未证明与本次反馈对应。
2. **观察预算不能中断单个同步调用。** `native/windows.cs` 的 `Capture.Visit` 在节点间检查 3 秒预算，但 `element.Current`、TreeWalker、pattern 调用内部没有该预算的抢占机制。窗口截图 455 行调用同步 `PrintWindow`，也没有本地超时参数。外层进程超时只限制 helper 生存时间，不能保证目标应用始终响应；这些代码本身不足以证明整个 Windows 内核挂死。
3. **分辨率限制仍允许较大临时分配。** 单窗截图允许宽高各 8192，原始 24bpp Bitmap 最坏约 192 MiB，然后才缩小到 1280。整屏路径额外有 16777216 像素总量限制，单窗路径没有同样的总像素限制。这是资源压力风险，不等同于已确认的内存泄漏。

## 已检查的保护

- helper 在首次原生请求时才启动；没有自动截图/输入定时器。仅闲置运行也卡死时，需要优先核对具体进程与系统事件，不能直接归因于拖拽路径。
- 未发现 `BlockInput`、全局键鼠 hook 或 `AttachThreadInput` 调用。
- JS 观察缓存最多 32 条、轨迹最多 100 条；原生观察/帧缓存最多各 32 条，UIA 元素句柄映射最多 2000 条，达到上限会报错而非无限增长。
- 后端日志最多 2000 条，日志页面最多 600 条；已检查的 Bitmap / Graphics / HDC 使用释放结构。未据此确认持续 GDI 泄漏，也没有排除 WebView2、驱动或其他进程问题。
- helper 是独立 MTA 线程模型，不能误报为在 Faber UI 线程直接执行 UIA。

## 采集反馈电脑的证据

在 Windows 上正常启动采样，再按平常方式使用 Faber：

```powershell
powershell -NoProfile -File .\diagnostics\diagnose-windows-freeze.ps1 -DurationSeconds 1800
```

采样结果默认保存在当前工作目录下的 `.local/diagnostics/windows-freeze-<时间>/`，该目录已被 Git 忽略。

默认每 5 秒将 Faber、service、computer helper、cloudflared、Explorer、DWM、WebView2 和常见 Shell/脚本进程的 CPU、内存、线程、句柄、GDI/USER 对象写入 CSV，并记录修饰键与鼠标按钮是否处于按下状态。同名进程采样包括其他应用，需要结合 PID/启动时间和任务管理器进程树区分；列表并不覆盖所有可能的子进程。累计 CPU 换算为整机百分比。部分保护进程计数可能不可读；零值不能单独证明资源健康。

脚本不执行桌面动作、终止进程、上传信息、读取命令行或截图。它尚未在 Windows 实机执行。系统完全冻结时采样也会停止，最后一条记录不一定能定位事故瞬间。

同时记录 Faber 版本、卡死时间、是否执行电脑控制、鼠标能否移动、Ctrl+Alt+Del 是否响应，以及任务管理器中异常进程。保留对应时间的 Faber 日志与事件查看器中的 Application Hang / Windows Error Reporting / Display 事件。不要将 Kernel-Power 41（强制重启记录）本身当作根因。

## 修复方向

- 在 Computer Use 源包中为输入序列设计独立于阻塞 UIA 线程的释放机制；只释放本 helper 已提交的输入，避免干扰用户真实按键。必须覆盖超时、取消和强杀，单纯增加 finally 不足够。
- 对阻塞 provider/截图隔离和降级，避免在输入保持按下时执行无界跨进程检查；保留目标归属与安全校验。
- 单窗截图增加总像素预算；用重复截图、无响应 provider、拖拽中断、宿主退出和长时间空闲的 Windows 测试验证。
- 修复并重新发布独立编译包后，Workbench 再升级固定版本。不要修改 node_modules 或在 Workbench 临时重编译替换已校验的发行 helper。

参考：[PrintWindow](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-printwindow)、[进程终止语义](https://learn.microsoft.com/en-us/windows/desktop/ProcThread/terminating-a-process)、[UIA 线程模型](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading)。
