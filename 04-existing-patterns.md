# 已有实现模式深度分析

## OpenAI：100 万行代码实验

OpenAI 用 Codex agent 构建了包含约 100 万行代码的代码库，完全无人工代码。核心经验：

1. **"Give a map, not a manual"** — Context 是稀缺的；巨大的指令文件会挤占任务/代码/文档的空间。结构比冗长更重要。
2. **Garbage Collection Agents** — 后台任务扫描偏差，更新质量评分，开启定向重构 PR，防止技术债积累。
3. **确定性 + LLM 混合** — Linter/测试做可靠护栏，LLM agent 做语义检查和自适应维护。
4. **Code Review 作为反馈** — 3 人小团队通过 PR 引导 agent，约 5 个月合并约 1,500 个 PR。

## Anthropic：长时运行 Agent 的 Harness 设计

### 两 Agent 架构

1. **Initializer Agent**（第一个 context window）：搭建基础设施 — 功能清单、进度文件、git repo、`init.sh` 环境脚本
2. **Coding Agent**（后续 session）：使用结构化 artifact 做增量进展

### Session 初始化协议

```
1. 运行 pwd 确认工作目录边界
2. 读取 git logs 和 progress files 获取近期上下文
3. 检查功能列表，选择最高优先级的未完成项
4. 执行 init.sh 启动开发环境
5. 运行基础端到端测试验证系统健康
```

### 使用 JSON（不是 Markdown）做功能追踪

```json
{
  "category": "functional",
  "description": "New chat button creates fresh conversation",
  "passes": false
}
```
理由：JSON 防止模型不当修改（agent 被指示只能修改 `passes` 字段）。

### 防御纵深

- Prompt guardrails
- Schema restrictions
- Runtime approval
- Tool validation
- Lifecycle hooks

### Context 管理

- **Compaction**：接近限制时压缩历史，保留决策
- **结构化笔记**：外部持久化笔记在 session 间重载
- **子 agent 委托**：专业 agent 返回浓缩摘要
- 目标：找到产生期望结果的最小高信号 token 集

## OMC (oh-my-claudecode)

### 已实现的能力

| 模块 | 功能 | 实现位置 |
|------|------|---------|
| **deepinit-manifest** | 确定性目录扫描 + 增量 diff | `src/tools/deepinit-manifest.ts` |
| **deepinit skill** | 生成层级化 AGENTS.md | `skills/deepinit/SKILL.md` |
| **autopilot pipeline** | 6 阶段自主流水线 | `src/hooks/autopilot/pipeline.ts` |
| **explore agent** | 代码库搜索专家（Haiku） | `agents/explore.md` |
| **29+ agent catalog** | 多层级专业 agent | agents 目录 |

### Autopilot 流水线

```
Phase 0: Expansion (Analyst → Architect)
Phase 1: Planning (Ralplan consensus)
Phase 2: Execution (Ralph + Ultrawork)
Phase 3: QA (UltraQA build/lint/test/fix 循环，最多5次，3失败熔断)
Phase 4: Validation (architect + security-reviewer + code-reviewer 并行)
Phase 5: Cleanup
```

### deepinit-manifest 核心逻辑

- `scanDirectories()`：递归扫描，跳过 .git/node_modules/dist 等，按目录记录文件列表
- `computeDiff()`：对比前后 manifest，标记 added/deleted/modified/unchanged
- 祖先级联：子目录变化时自动标记父目录为 modified
- 增量模式 vs 全量模式

## Bootstrap Framework (Dotzlaw)

### 三文件夹分离

1. **Framework repo** — 可复用知识、模板、方法论（项目无关）
2. **Source project** — 已有代码库（READ-ONLY，永不修改）
3. **Target project** — 带有生成基础设施的新项目

### 在 20-40 分钟内生成

- 4 个分层 subagent 定义（Opus/Sonnet 分层）
- 7 个渐进式加载 skill
- 6 个 hook 配置（PreToolUse/PostToolUse/Stop 门）
- 6 个 slash command
- 10 个可复用模板
- CLAUDE.md 项目定位文件

### 实测数据

- Migration 1（45 Python 文件）：10 sessions，223 个测试从零创建，7 类反模式修复
- Migration 2（67 Python 文件）：8 sessions — 更复杂但更少 session（复合收益验证）

### 复合改进系统

三个时间尺度的反馈循环：
- **分钟级**：hooks 在每次工具使用时确定性执行质量检查
- **Session 级**：skills 保留从失败中学到的领域模式
- **月级**：agent 定义积累约束和专业化

## AI SDLC Scaffold

```
4-Phase Structure:
  1-spec/   → CLAUDE.spec.md (goals, requirements, assumptions)
  2-design/ → CLAUDE.design.md (architecture, data models, API)
  3-code/   → CLAUDE.code.md (implementation tasks)
  4-deploy/ → CLAUDE.deploy.md (operational runbooks)

+ 描述性 ID: GOAL-*, REQ-*, DEC-* (创建 需求→实现 可追溯性)
```

每阶段有独立指令文件和 agent 团队。Context-window 高效：层级结构最小化每次操作的 token 负载。

## Claude Code Hooks 系统

### 26 个生命周期事件

| 事件 | 触发时机 | 可阻断 |
|------|---------|--------|
| SessionStart | session 开始或恢复 | 否 |
| UserPromptSubmit | Claude 处理 prompt 前 | 是 (exit 2) |
| PreToolUse | 任何工具调用前 | 是 (exit 2) |
| PostToolUse | 工具调用成功后 | 是 |
| PostToolUseFailure | 工具调用失败后 | 否 |
| Stop | Claude 完成回复 | 是 (continue loop) |
| SubagentStart/Stop | 子 agent 生命周期 | 否 |
| PreCompact/PostCompact | context 压缩前后 | 否 |
| SessionEnd | session 终止 | 否 |
| ... | 其他 16 个事件 | ... |

### 三种 Hook 类型

- `type: "command"` — shell 命令，通过 stdin/stdout/exit code 通信
- `type: "prompt"` — 单轮 LLM 调用（默认 Haiku）
- `type: "agent"` — 多轮 subagent，60s 超时，最多 50 次工具使用
- `type: "http"` — HTTP POST 到任意端点

### Exit Code 语义

- `exit 0` — 继续；stdout 注入 Claude 上下文
- `exit 2` — 阻止动作；stderr 作为反馈显示给 Claude
- 其他 — 继续；stderr 仅记录日志
