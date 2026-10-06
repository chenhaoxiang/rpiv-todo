# rpiv-todo — 维护 fork

[English](README.md) | 中文

Pi 的 Claude-Code 风格 `todo` 工具、`/todos` 命令和编辑器上方的持久任务视图。维护仓：<https://github.com/chenhaoxiang/rpiv-todo>。

## 发布版本与分支约定

当前维护版本为 **0.1.2-fork.1**，基于社区 **0.1.2**。fork 版本统一使用 `<社区版本>-fork.<修订号>`，本地修订不冒充社区新版本。

- `main`：我们的维护、整合与发布主线，保留 fork 修复。
- `upstream-main`：仅镜像社区 `main`，不加入 fork 提交，也不作为安装来源。
- 改动通过经过审核的 PR 合入 `main`；保留现有分支和历史。

固定版本安装：

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@v0.1.2-fork.1
```

[GitHub Releases](https://github.com/chenhaoxiang/rpiv-todo/releases) 提供可安装的包、来源清单和 `SHA256SUMS` 校验文件；这不是向上游作者的 npm 命名空间发布。发布及制品安装流程见[维护说明](docs/releasing.md)。

原先未注明 fork 的版本 `0.1.4`，按真实社区基线规范为 `0.1.2-fork.1`；不回退宿主依赖或 overlay 行为。

## 安装本 fork

只有需要跟踪维护主线时才使用：

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@main
```

上游 npm 包与本 fork 是不同来源，固定版本命令见上文。安装后重启或 `/reload`。

## 工具与命令

- **`todo`**：创建、更新、列出、查看、删除或清空任务；
- **`/todos`**：交互模式下按状态列出未删除任务；
- **`rpiv-todos` widget**：任务变化时更新的编辑器上方视图。

```ts
todo({ action: "create", subject: "审核 API 改动", activeForm: "审核 API 改动中" })
todo({ action: "update", id: 1, status: "in_progress" })
todo({ action: "list" })
todo({ action: "get", id: 1 })
todo({ action: "update", id: 1, status: "completed" })
```

四种状态：`pending`、`in_progress`、`completed` 和 tombstone `deleted`。待处理与执行中可来回切换，也可完成；已完成任务不能重新打开；未删除状态可删除。无效转换返回结构化错误，不修改状态。

## 依赖、归属与元数据

创建时通过 `blockedBy: [1]` 声明初始依赖；更新时通过 `addBlockedBy` / `removeBlockedBy` 增量修改。归约器拒绝不存在/已删除依赖、自己依赖自己、依赖循环、无任何可变字段的更新和非法状态转换。依赖是任务信息，不负责执行调度或替代理决定是否开始。

可选字段还有 `description`、`activeForm`、`owner` 和 `metadata`。元数据按 key 合并，值为 `null` 时移除该 key。

## 持久化与视图

状态保存于 Pi 当前会话分支的工具结果 details。会话启动、压缩和树变化时，从当前分支最后一个有效快照重建；能够跨 reload、压缩和分支导航保留，不是跨会话共享数据库。

视图在存在未删除任务时显示，展示状态、活动标签、ID 和依赖；长列表折叠到 12 行，空间不足时先隐藏完成项而不是活跃工作；没有可见任务时注销 widget。reload 或 UI 上下文改变后重新绑定，渲染读取实时模块状态，不使用过时 tool_execution_end 快照。

## 兼容性与限制

- 使用宿主提供的 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 和 `typebox`；
- 公开工具名保持 `todo`，确保权限规则和历史工具结果兼容；
- 状态只在 Pi 会话历史中保存，不跨机器或跨会话同步；
- `/todos` 需要交互模式；工具可在 Pi 能返回结构化结果的模式下使用；
- 任务工具只记录状态，不执行代码；标记 completed 不证明测试、Git 合并、部署或上线已经完成。保护包含任务文本/路径的本地会话数据。

## 开发与验证

```bash
npm install --ignore-scripts
```

当前没有自动化功能测试脚本；不要宣称 `npm test` 通过。发布检查覆盖包内容及不调用真实模型的隔离 RPC 加载，交互 overlay 仍需手工验证。检查行为修改时应使用合成任务和一次性 Pi 目录，覆盖 create/update、依赖循环、状态回放及空/普通/超长视图，不读取真实私人会话。

## 许可证

MIT
