# Faber 使用教程

打开 Faber 并启动 Runtime，就可以把当前项目连接到 ChatGPT 或 Claude。第一次用，先完成连接，再按需开启电脑和浏览器控制、添加 MCP 服务或导入 Skill。

## 1. 安装并启动 Faber

1. 下载适合自己电脑的安装包。Mac 的 M 系列芯片选文件名以 `aarch64.dmg` 结尾的安装包，Intel 芯片选 `x64.dmg`，打开后把 Faber 拖入「应用程序」。Windows x64 运行文件名以 `-setup.exe` 或 `.msi` 结尾的安装包。 [下载 Faber](https://github.com/HideInMatrix/Faber/releases/latest)
2. 打开 Faber，在左侧进入「Runtime」，点击「工作目录」旁的文件夹图标，选中这次要交给 AI 使用的项目文件夹。
3. 「网络方案」选「Cloudflare Tunnel」。首次试用可以把「公网域名」和「Tunnel Token」都留空，Faber 启动后会给出一个临时地址。其余网络选项可以先用默认值。 [Cloudflare 临时地址说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
4. 在「OAuth 密码」设置一个只有自己知道的密码，连接 ChatGPT 或 Claude 时在 Faber 授权页填写。「权限模式」可先选「请求批准」，遇到修改操作时按提示确认。
5. 点击「保存」，再点击「启动」。等页面显示「运行中」并出现公网地址，点击地址右侧的复制按钮，复制包含 `/mcp` 的完整地址。

使用时请保持 Runtime 运行。临时地址在下次启动时可能变化，地址变了就用新地址重新添加插件或连接器。经常使用的话，可以在 Cloudflare 绑定固定域名，将服务指向 Faber 界面显示的「监听地址」和「本地端口」，再把域名和对应的 Tunnel Token 一起填入 Faber。 [Cloudflare 固定域名设置](https://developers.cloudflare.com/tunnel/get-started/)

## 2. 添加到 ChatGPT

1. 打开 ChatGPT 网页版，进入侧边栏「插件」，点击「＋」→「添加自定义 MCP 服务器」。若没有这个选项，请检查当前账号和工作区是否允许添加自定义插件。 [打开 ChatGPT 插件页](https://chatgpt.com/plugins) · [官方添加指引](https://developers.openai.com/api/docs/guides/custom-mcp-server)
2. 名称填 `Faber` 或你容易识别的项目名称。「连接」选「服务器 URL」，粘贴从 Faber 复制的完整地址。
3. 「身份验证」选「OAuth」。如果「高级 OAuth 设置」要求选择客户端配置方式，选「CIMD」，并使用自动发现的设置。 [ChatGPT 官方授权选项](https://developers.openai.com/api/docs/guides/custom-mcp-server)
4. 确认地址来自自己的 Faber，勾选「我已了解，并希望继续」，点击「创建为插件」。创建或安装时出现 Faber 的授权页面，就输入在 Runtime 中设置的 OAuth 密码，点击「授权连接」。
5. 在插件列表中打开刚创建的插件，按提示安装。新建对话，在输入框键入 `@` 选中该插件，先试一句「请列出当前项目文件夹中的文件」。 [ChatGPT 官方使用指引](https://developers.openai.com/api/docs/guides/custom-mcp-server)

## 3. 添加到 Claude

1. 在 Claude 网页版打开「自定义（Customize）」→「连接器（Connectors）」，点击「添加」，再选「自定义 → Web」或「添加自定义连接器（Add custom connector）」。团队工作区需要由有权限的管理员先添加。 [Claude 官方添加指引](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
2. 填写名称，粘贴从 Faber 复制的完整地址，点击「继续」。
3. 保留自动识别的 OAuth 设置。若询问何时登录，选「立即登录（Sign in now）」。若询问 OAuth 客户端，选「使用 Claude 的公开身份（推荐）」，然后点击「添加」。 [Claude 官方授权选项](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
4. 如果连接器显示「连接（Connect）」，点击它。在 Faber 的授权页面输入 Runtime 中设置的 OAuth 密码，点击「授权连接」。
5. 新建对话，点击输入框左下角「＋」→「连接器」，启用刚添加的 Faber，再试着让 Claude 列出当前项目里的文件。 [Claude 官方启用指引](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

## 4. 开启 Computer Use 电脑控制

1. 在 Faber 的「Runtime」页点击「停止」。进入「插件」，打开「Computer Use」开关。如果旧配置显示「只读」，需要点击「启用控制动作（保留本机审批）」才能让 AI 操作。
2. macOS 点击「设置权限」，按系统提示允许「辅助功能」和「屏幕录制」，然后回 Faber 点击「重新检测」。Windows 请在已登录且解锁的桌面上使用。
3. 只需要桌面控制时，回「Runtime」点击「启动」即可。想让 AI 操作当前 Chrome 或 Edge 中的网页，先完成下一节的扩展安装，再启动。
4. 在 ChatGPT 或 Claude 中选中 Faber 后，告诉 AI 要操作哪个应用、要做什么。出现审批时在本机确认。可以先试「请用 Faber 查看我当前打开的应用窗口，告诉我窗口标题」。

## 5. 安装 Chrome 或 Edge 浏览器扩展

1. 保持 Runtime 停止。在「插件 → Computer Use」展开「浏览器连接」，选择「使用当前浏览器（推荐）」，再选 Google Chrome 或 Microsoft Edge。
2. 点击「准备浏览器扩展」，再点击「复制扩展目录」。第一次需要到浏览器里手动加载一次。
3. 在所选浏览器的地址栏打开扩展管理页。Chrome 用 `chrome://extensions`，Edge 用 `edge://extensions`。
4. 打开「开发者模式」（Edge 也可能显示「开发人员模式」），点击「加载已解压的扩展程序」或「加载解压缩」（Load unpacked），选择 Faber 给出的**整个扩展目录**。 [Chrome 安装说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world?hl=zh-cn) · [Edge 安装说明](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/getting-started/extension-sideloading)
5. 在浏览器的扩展菜单找到「Faber」，可以固定到工具栏。回 Faber 点击「刷新连接状态」，确认「浏览器扩展已连接」，然后点击「保存」。如果只想让 AI 访问指定网站，可以在保存前打开「限制可访问的网站」，每行填一个网站地址。
6. 回「Runtime」点击「启动」。在已经连接 Faber 的对话里，可以试一句「请用 Faber 的浏览器功能打开 `https://example.com`，告诉我页面标题」。需要中途停止时，点击浏览器工具栏里的 Faber 图标，选择「停止操作」。

## 6. 在 Faber 添加第三方 MCP 服务

1. 停止 Runtime，进入「插件 → MCP 服务 → 添加 MCP」。填「名称」，可在「用途说明」写清它能做什么，方便 AI 按任务找到它。
2. 如果服务商给你一个网址，按其说明选择「传输」，常用的是「Streamable HTTP」，然后把网址填到「MCP 地址」。如果服务商提供的是本地程序，选「stdio · 本地子进程」，按服务商说明分别填写程序、启动参数和所需的环境变量。
3. 按服务商说明选择「认证」。公开服务可选「无认证」。收到令牌或密钥时，选「Bearer Token」或「API Key」，填入你自己的凭据。若服务商指定了「密钥 Header 名称」，也按说明填写。要求网页登录时，选「OAuth 浏览器授权」，点击「授权登录」，在浏览器完成授权后回到 Faber。
4. 点击「测试连接」，看到工具列表后点击「保存配置」，确认列表里的服务开关已开启。启动方式可以保留「按需启动」，AI 用到时再连接。想每次打开 Runtime 就连接，选「随 Runtime 启动」。
5. 重新启动 Runtime，在对话里说要用哪个服务完成什么任务。例如「请用我在 Faber 添加的设计服务，查看这个设计稿并概括页面内容」。

## 7. 在 Faber 添加 Skill

Skill 适合保存反复使用的做事步骤，比如周报格式、设计检查清单或文档整理规则。

**导入已有 Skill**

1. 停止 Runtime，进入「插件 → Skills → 添加 Skill」，选择「导入本地 Skill 目录 / SKILL.md」。
2. 点击「选择目录」选中 Skill 文件夹。如果手头是单独一份 `SKILL.md`，也可以把文件的完整路径填入路径栏。
3. 点击「扫描目录」，勾选想用的条目，再点击「添加所选 Skill」。确认它已启用，重新启动 Runtime。

**在 Faber 新建 Skill**

1. 在「添加 Skill」里选择「创建 SKILL.md」。
2. 「来源 ID」用小写字母开头，例如 `weekly-report`。「描述」写适用场景，「方法说明」写希望 AI 遵循的步骤。点击「添加」，再启动 Runtime。

在 ChatGPT 或 Claude 中选中 Faber，就可以说「请按我在 Faber 里添加的周报 Skill，整理这份记录」。以后要停用某个 Skill，先停止 Runtime，再关闭该条目的开关。

## 连接不顺时先检查什么

| 看到的情况 | 可以先做什么 |
| --- | --- |
| 网页提示找不到授权设置或无法连接 | 在 Faber 确认 Runtime 正在运行，重新复制完整地址。如果使用临时地址，确认填写的是这次启动显示的地址。 |
| 授权页面提示密码不正确 | 输入 Faber「Runtime」里设置的 OAuth 密码。 |
| Faber 的插件设置按钮是灰色 | 先回「Runtime」点击「停止」，再回来修改。 |
| 浏览器扩展显示未连接 | 确认装在 Faber 选中的 Chrome 或 Edge 中，打开工具栏的 Faber 图标查看状态，再回 Faber 点击「刷新连接状态」。 |
| 新启用的功能在对话里看不到 | 确认已经重新启动 Runtime，并在当前对话选中 Faber。ChatGPT 可在插件详情刷新工具。 [ChatGPT 官方刷新指引](https://developers.openai.com/api/docs/guides/custom-mcp-server) |
