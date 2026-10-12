# Faber v1.0.2

## 更新内容

- 新增中英文界面切换：侧边栏提供语言下拉框，默认中文，并记住本机选择。
- 补充 Runtime、插件、MCP、Skills、Computer Use、日志和关于页面的英文界面文案。
- 切换语言无需重启，不改变 Runtime 状态、未保存的表单、密钥或权限设置；日志和用户输入保留原文。
- 新增英文 README 和双向语言跳转，补充功能特色与 Computer Use 使用说明。
- 增加语言默认值、持久化、文案完整性和状态隔离回归测试。

## 兼容与安装

- 保持应用配置、Bundle ID 和更新签名的兼容性。
- macOS 主应用要求 macOS 13 或更高版本；Windows 仅支持 x64。
- macOS 使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。
- Release 提供桌面安装包、更新归档、更新清单和校验文件。
