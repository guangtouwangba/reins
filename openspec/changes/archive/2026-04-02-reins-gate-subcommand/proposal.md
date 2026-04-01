## Why

Reins 当前的 Hook 系统存在一个根本性的架构缺陷：**Hook 脚本是内联的 shell `grep`，而不是调用 Reins 自身的能力。**

这意味着：

1. **约束检查只能做字符串匹配**：`grep -qE 'try.*catch'` 无法理解代码语义。它会误报注释里的 try/catch，漏报变量赋值形式的错误处理。
2. **上下文注入是静态的**：`UserPromptSubmit` hook 只能匹配 prompt 中的关键词然后输出固定文本，无法根据当前任务动态检索知识库、匹配技能。
3. **知识系统与 Hook 断开**：Knowledge 系统（capture/retrieval/injection）已经实现，但 Hook 脚本无法调用它。
4. **每个约束一个脚本**：N 个约束生成 N 个独立 shell 脚本，每个都要解析 `CLAUDE_TOOL_INPUT` JSON、检查 jq 依赖。这是不必要的开销和维护负担。

根本问题：**Reins 有完整的 Node.js 运行时（scanner、constraints、knowledge、evaluation），但 Hook——唯一确定性执行的集成点——被限制在 shell 脚本里，无法使用这些能力。**

`reins gate` 子命令解决这个问题：它是一个统一的 CLI 入口，Hook 脚本只需一行 `reins gate <event>`，背后是完整的 Reins 运行时。

## What Changes

### 1. `reins gate` CLI 子命令 (`src/commands/gate.ts`)

新的 CLI 命令，作为所有 Hook 脚本的统一后端。接收 Claude Code 的 Hook 事件，执行完整的约束检查、上下文注入和知识操作。

支持 4 种事件：

| 事件 | Claude Code Hook | 触发时机 |
|------|-----------------|---------|
| `reins gate context` | UserPromptSubmit | 用户输入需求时 |
| `reins gate pre-edit` | PreToolUse (Edit/Write) | 修改文件前 |
| `reins gate post-edit` | PostToolUse (Edit/Write) | 修改文件后 |
| `reins gate pre-bash` | PreToolUse (Bash) | 执行命令前 |
| `reins gate stop` | Stop | 任务结束前 |

每个事件从 `CLAUDE_TOOL_INPUT` 环境变量读取 Claude Code 传入的 JSON 数据。

### 2. Gate Context — 动态上下文注入 (`src/gate/context.ts`)

当用户输入需求时，动态组装上下文：

- 从 `constraints.yaml` 加载所有约束
- 从 `.reins/knowledge/` 检索相关知识（基于 prompt 关键词 + 文件亲和性）
- 从 `skill-index.json` 匹配相关技能
- 格式化为 `[Reins Context]` 注入文本输出到 stdout

### 3. Gate Pre-Edit — 编辑前约束检查 (`src/gate/pre-edit.ts`)

在 Claude 修改文件前：

- 检查文件是否在保护区（`.reins/`、`constraints.yaml`）
- 加载该文件/目录相关的约束
- 扫描将要写入的内容，检查是否违反约束
- block 模式返回 exit 2，warn 模式输出警告

### 4. Gate Post-Edit — 编辑后验证 (`src/gate/post-edit.ts`)

文件修改后：

- 读取修改后的文件
- 运行模式分析（import 风格、错误处理风格、类型标注）
- 匹配约束规则
- 违规则 warn 或 block

### 5. Gate Pre-Bash — 命令守卫 (`src/gate/pre-bash.ts`)

执行 bash 命令前：

- 解析命令内容
- 检查危险命令模式（rm -rf、force push 等）
- 从知识库检索命令相关的 gotcha
- block 或 warn

### 6. Gate Stop — 完成门禁 + 知识捕获 (`src/gate/stop.ts`)

Claude 想结束任务时：

- 运行 L0 评估（lint + typecheck + test）
- 检查新文件是否有对应测试
- 分析 git diff 自动提取知识候选（coupling、decision）
- 通过则放行，不通过则 block（Claude 被迫继续修）

### 7. Hook 模板重构 (`src/hooks/generator.ts`)

将现有的 N 个内联 grep 脚本替换为统一的 `reins gate` 调用模板。每种 Hook 事件只需一个 shell 脚本：

```bash
#!/bin/bash
reins gate post-edit
```

### 8. Settings Writer 简化 (`src/hooks/settings-writer.ts`)

不再为每个约束注册独立 Hook，而是按事件类型注册 5 个统一 Hook。

## Capabilities

### New Capabilities
- `gate-context`: 动态上下文注入，整合约束 + 知识 + 技能
- `gate-pre-edit`: 语义级编辑前检查（替代 grep 正则）
- `gate-post-edit`: 编辑后模式验证
- `gate-pre-bash`: 命令守卫 + 知识提醒
- `gate-stop`: 完成门禁（L0 评估）+ 自动知识捕获

### Modified Capabilities
- `hook-generator`: 从 N 个内联脚本简化为 5 个统一入口脚本
- `settings-writer`: 从 per-constraint 注册简化为 per-event 注册
- `init-command`: 生成新格式 Hook

## Impact

- Affected code: `src/commands/gate.ts` (new), `src/gate/*.ts` (new), `src/hooks/generator.ts` (rewrite), `src/hooks/settings-writer.ts` (simplify), `src/cli.ts` (add gate command), `src/commands/init.ts` (use new hook generation)
- Affected systems: Hook system, CLI, Knowledge system (retrieval), Evaluation system (L0/L1)
- APIs/UX: New `reins gate` CLI command（用户不直接使用，由 Hook 脚本调用）
- Phase: P2 — replaces existing hook implementation with Reins-runtime-backed version
- Dependencies: builds on existing constraint, knowledge, evaluation, and skill systems

## Design Principles

1. **Hook 是管道，Reins 是引擎** — Hook 脚本只做一件事：调用 `reins gate`。所有逻辑在 Node.js 运行时执行。
2. **确定性优先** — Gate 的行为由 constraints.yaml 和 config.yaml 决定，不依赖 LLM。
3. **快速失败** — Gate 操作必须在 2 秒内完成（Claude Code Hook 有超时）。长操作（L0 test）在 stop 阶段执行。
4. **渐进增强** — 没有 AST 分析器时用正则检查，有 AST 时自动升级。Gate 层不依赖 AST，但可以利用它。
5. **向后兼容** — 现有 `constraints.yaml` 格式不变。已有的 hook_type/hook_check 字段仍然有效。

## Risks / Trade-offs

- [Node.js 启动开销] → 每次 Hook 触发都要启动一个 Node 进程。Mitigate: 使用 `tsx` 开发模式下有缓存；生产模式用编译后的 JS。Claude Code Hook 超时通常 30s+，Node 启动 < 200ms。
- [Gate stop 运行测试可能很慢] → Mitigate: 使用 constraints.yaml 的 pipeline.pre_commit 配置，只跑快速检查。提供 `gate.stop.skip_test: true` 配置项。
- [知识检索可能返回噪音] → Mitigate: 使用已有的 confidence scoring 和 max injection budget。
- [从 per-constraint hooks 迁移到 unified gate] → Mitigate: `reins init --force` 重新生成；旧脚本在 `.reins/hooks/` 会被覆盖。
