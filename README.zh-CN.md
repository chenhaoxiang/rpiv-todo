# rpiv-todo — 维护 fork

[English](README.md) | 中文

一个 Pi 扩展，提供类似 Claude Code 的 `todo` 工具、`/todos` 命令，以及编辑器上方的持久 TodoOverlay。

维护 fork 仓库：

<https://github.com/chenhaoxiang/rpiv-todo>

## 安装本 fork

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@main
```

需要可复现安装时，可固定审核过的提交：

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@<reviewed-commit>
```

安装后重启 Pi 或执行 `/reload`。

## 工具与命令

扩展注册：

- **`todo`**：创建、更新、列出、查看、删除或清空任务；
- **`/todos`**：按状态打印当前未删除任务；
- **`rpiv-todos` widget**：任务变化时自动刷新、显示在编辑器上方的持久视图。

示例：

```ts
todo({ action: "create", subject: "Review the API diff", activeForm: "reviewing the API diff" })
todo({ action: "update", id: 1, status: "in_progress" })
todo({ action: "list" })
todo({ action: "get", id: 1 })
todo({ action: "update", id: 1, status: "completed" })
```

任务状态有四种：

```text
pending → in_progress → completed
    └───────────────┘
任意未删除状态 → deleted
```

已完成任务不能重新打开。无效状态转换会返回结构化错误，不会修改任务状态。

## 依赖与任务归属

任务支持 `blockedBy` 依赖关系和循环检测。创建任务时可以声明阻塞任务；依赖未完成时，任务仍会显示为待处理，避免多个 Agent 同时推进互相依赖的工作。

任务状态按分支回放持久化，可以跨 session compact 和 `/reload` 保留。`deleted` 是 tombstone，不会让历史任务从持久记录中消失。

## 持久化与 Overlay

只要存在未删除任务，编辑器上方的 widget 会自动显示。任务较多时按固定高度折叠；完成任务优先被隐藏，未完成任务会继续保留，过长文本会被截断。任务列表为空时，widget 自动隐藏。

`/todos` 适合在没有 UI 或需要纯文本输出时查看当前列表；Overlay 适合在交互式 TUI 中持续观察进度。

## 兼容性与边界

- 这是 Pi 扩展，不修改 Pi 核心；
- 任务工具只管理任务状态，不执行代码、不替用户声明测试通过；
- `completed` 代表任务状态已完成，不等于代码已经合并、部署或上线；
- 删除任务只写入 deleted tombstone，不会伪造历史不存在；
- 具体任务内容、文件路径和阻塞关系会写入本地 Pi 状态目录，请按本机隐私策略保护。

## 开发

```bash
npm install
npm test
```

测试使用一次性任务目录和合成状态，不使用生产凭据或私人任务历史。

## 许可证

MIT
