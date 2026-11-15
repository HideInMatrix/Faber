# Git Commit 规范

本仓库的后续提交统一使用：

```text
<type>(<scope>): <中文提交内容>
```

- `type` 和 `scope` 保持英文，例如 `fix(runtime)`、`feat(computer-use)`、`docs(commit)`。
- 冒号后留一个空格；提交内容使用中文，直接描述本次改动。
- 不把 `fix` 等类型翻译成“修复”“迁移”等中文前缀。
- 提交标题末尾不附带版本号，也不追加“发布 vX.Y.Z”“准备 vX.Y.Z 发布”等内容。
- 发布版本记录在 Git tag、版本文件和 Release notes 中，不放在提交标题中。
- 此规则用于后续提交，不重写已推送的历史提交。

示例：

```text
fix(runtime): 修复停止请求超时后的状态确认
refactor(computer-use): 将电脑控制模块迁回本地工作区
docs(commit): 补充中文提交规范
```

# 对外更新说明

- Commit 标题、tag 注释、Release notes 和公开更新文档只描述用户可见的功能、修复及使用变化。
- Computer Use 的内部设计、实现方式、调用链路、原生资源组成和内部验收过程不写入上述说明。
- 构建、签名、许可证及安全验证文件不得为精简文档而删除或放宽检查。
