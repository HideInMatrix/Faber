# Faber v1.0.0

## 更新内容

- 软件正式命名为 Faber，统一窗口标题和安装包名称。
- 精简 README 的「开源鸣谢」，仅保留 [Pi Agent](https://github.com/earendil-works/pi)。
- 移除公开 README 中的额外文档入口及对应说明文档，安装包继续附带必要的第三方许可文本。

## 兼容与安装

- 保持应用配置、Bundle ID 和更新签名的兼容性。
- macOS 主应用要求 macOS 13 或更高版本；Windows 仅支持 x64。
- macOS 使用长期自签名证书，未经过 Apple 公证；Windows 安装包未进行 Authenticode 签名。
- Release 提供桌面安装包、更新归档、更新清单和校验文件。
