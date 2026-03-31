# 自进化 Harness：日志收集、Skill 进化与自动创建

## 你的三个问题

1. **应该收集运行时日志来持续改进吗？** — 是的，而且 OMC 已经实现了。
2. **Skills 会进化吗？** — 是的，OMC 有 Level 7 自改进 skill 和质量评分系统。
3. **系统会按需自己创建 skills 吗？** — 是的，OMC 的 auto-learner 会自动检测"可提取时刻"并建议创建新 skill。

但这三个能力在现有实现中是**分散的、被动的**。一个真正的自进化 harness 需要把它们统一成一个**闭环反馈系统**。

---

## 一、OMC 已有的三层学习机制

### 层 1：运行时日志 — Session Replay + Trace

OMC 已经收集了详细的运行时数据：

```
.omc/state/
├── agent-replay-{sessionId}.jsonl   # Agent 执行回放日志
├── sessions/{sessionId}/            # Session 状态
└── ...
```

**Session Replay** (`session-replay.ts`) 记录的事件类型：

| 事件类型 | 记录内容 |
|----------|---------|
| `agent_start` / `agent_stop` | 哪个 agent 被调用，耗时多久 |
| `tool_start` / `tool_end` | 工具调用及其结果 |
| `file_touch` | 修改了哪些文件 |
| `error` | 发生了什么错误 |
| `hook_fire` / `hook_result` | Hook 触发和结果 |
| `keyword_detected` | 检测到哪些关键词 |
| `skill_activated` / `skill_invoked` | 哪些 skill 被激活和使用 |
| `mode_change` | 模式切换 |
| `intervention` | 人工干预点 |

**Session Search** (`session-history-tools.ts`) — 可以跨 session 搜索历史记录：
```typescript
// 支持按时间、项目、session ID 过滤
searchSessionHistory({
  query: "error handling pattern",
  since: "7d",        // 最近 7 天
  project: "my-app",  // 特定项目
  limit: 10,
})
```

**Trace Tools** (`trace-tools.ts`) — 格式化的 agent 流程可视化：
- `trace_timeline`：时间轴视图，显示每个事件的时间和类型
- `trace_summary`：摘要视图，统计 agent 调用、工具使用、错误分布

### 层 2：Skill 进化 — Level 7 自改进 Skill

OMC 的 Learner Skill 被标记为 **Level 7（self-improving）**，有一个关键的双区结构：

```markdown
# Learner Skill (Level 7)

## Expertise  ← 这部分会自动更新
> 域知识，随着新模式的发现而改进

## Workflow   ← 这部分保持稳定
> 提取流程，很少变化
```

**进化机制**：
- Expertise section 可以被 learner 自身在发现新模式时更新
- Workflow section 保持稳定，防止流程退化
- 这实现了"知识进化但流程不变"的稳定性

**质量评分系统** (`auto-learner.ts`)：

```typescript
interface PatternDetection {
  id: string;
  problem: string;
  solution: string;
  confidence: number;      // 0-100 技能价值评分
  occurrences: number;     // 模式出现次数
  firstSeen: number;
  lastSeen: number;
  suggestedTriggers: string[];
  suggestedTags: string[];
}
```

评分维度：
| 因素 | 分数影响 |
|------|---------|
| 基础分 | 50 |
| 包含文件路径 | +15 |
| 包含错误信息 | +15 |
| 高价值关键词（error, fix, workaround...） | +5 每个，最多 +20 |
| 重复出现 | +10 每次，最多 +30 |
| 解决方案详细（>100字） | +10 |
| 解决方案非常详细（>300字） | +10 |
| 通用模式（"try again", "check docs"） | -15 |
| 内容太短 | -20 |
| 缺少触发词 | -25 |

**阈值**：confidence >= 70 才建议提取为 skill。

### 层 3：自动创建 Skill — Auto-Learner + Detection Hook

OMC 的 **Detection Hook** 在每条 assistant 消息中自动检测"可提取时刻"：

```typescript
// 5 种可检测模式
type PatternType =
  | 'problem-solution'   // 问题+解决方案 (confidence: 80)
  | 'technique'          // 有用技巧 (confidence: 70)
  | 'workaround'         // 变通方案 (confidence: 60)
  | 'optimization'       // 优化方法 (confidence: 65)
  | 'best-practice'      // 最佳实践 (confidence: 75)
```

**检测流程**：
```
Assistant 回复
    ↓
detectExtractableMoment() — 正则匹配 5 种模式（支持中英日韩西）
    ↓
shouldPromptExtraction() — confidence >= 60?
    ↓  Yes
generateExtractionPrompt() — 建议用户保存为 skill
    ↓  用户确认
/oh-my-claudecode:learner — 提取并保存
```

**冷却机制**：每 5 条消息最多提示一次，避免打扰。

**Promotion 系统** (`promotion.ts`) — 从 Ralph 循环的 learnings 中提升为正式 skill：
```
Ralph 执行循环 → 记录 learnings → getPromotionCandidates() → promoteLearning() → 正式 skill
```

---

## 二、当前实现的缺陷

虽然 OMC 已经有了这三层机制，但存在以下缺陷：

### 缺陷 1：日志是被动的，不是主动分析的

```
当前：记录日志 → 人工用 trace/session_search 查看
缺失：记录日志 → 自动分析 → 自动改进约束
```

日志被记录了，但没有一个**自动分析管道**来从日志中提取改进信号。

### 缺陷 2：Skill 进化是手动触发的

```
当前：检测到模式 → 提示用户 → 用户手动确认 → 保存 skill
缺失：检测到模式 → 自动评估 → 高置信度自动保存 → 低置信度才问用户
```

### 缺陷 3：约束文件不会自动更新

```
当前：deepinit 生成 AGENTS.md → 不再变化（除非手动重跑）
缺失：运行时发现新模式 → 自动更新 CLAUDE.md/AGENTS.md 中的约束
```

### 缺陷 4：没有跨项目学习

```
当前：每个项目的 skill 独立存在
缺失：项目 A 学到的模式 → 抽象 → 应用到类似的项目 B
```

---

## 三、自进化 Harness 的完整设计

### 核心闭环

```
┌─────────────────────────────────────────────────────────┐
│                 自进化 Harness 闭环                       │
│                                                          │
│     ┌──────────┐                                         │
│     │  EXECUTE  │ ← 在约束下执行开发任务                    │
│     └────┬─────┘                                         │
│          │ 产出运行时日志                                   │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │  OBSERVE  │ ← 收集结构化执行数据                      │
│     └────┬─────┘                                         │
│          │ session replay, trace, error logs              │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │  ANALYZE  │ ← 自动分析成功/失败模式                   │
│     └────┬─────┘                                         │
│          │ 模式检测, 根因分析, 效率评估                      │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │  LEARN    │ ← 提取/进化 skill, 更新约束               │
│     └────┬─────┘                                         │
│          │ 新 skill, 更新的 constraints.yaml               │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │ CONSTRAIN │ ← 重新生成约束文件                        │
│     └────┬─────┘                                         │
│          │ 更新 CLAUDE.md / AGENTS.md                     │
│          └──────────→ 回到 EXECUTE                        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 模块设计

#### 模块 A：Observer（观察器）

在 OMC 已有的 session replay 基础上，增加结构化数据收集：

```typescript
interface ExecutionObservation {
  // 基本信息
  sessionId: string;
  taskDescription: string;
  timestamp: string;
  duration: number;

  // 执行结果
  outcome: 'success' | 'partial' | 'failure';

  // 模式数据
  agentsUsed: { name: string; model: string; duration: number; success: boolean }[];
  toolsUsed: { name: string; count: number; errorRate: number }[];
  filesModified: string[];
  testsRun: { total: number; passed: number; failed: number };

  // 问题数据
  errors: { type: string; message: string; file?: string; resolution?: string }[];
  retries: { tool: string; count: number; reason: string }[];
  humanInterventions: { reason: string; action: string }[];

  // 约束违反
  constraintViolations: { rule: string; file: string; description: string }[];

  // Review 反馈
  reviewFeedback: { reviewer: string; issues: string[]; approved: boolean }[];
}
```

#### 模块 B：Analyzer（分析器）

定期（或每个 session 结束后）分析累积的观察数据：

```typescript
interface AnalysisResult {
  // 效率指标
  metrics: {
    avgTaskDuration: number;
    successRate: number;
    avgRetries: number;
    humanInterventionRate: number;
  };

  // 发现的模式
  patterns: {
    // 反复出现的错误 → 应该成为新约束
    recurringErrors: { error: string; frequency: number; suggestedConstraint: string }[];

    // 反复的人工干预 → 应该成为新 hook 或约束
    recurringInterventions: { reason: string; frequency: number; suggestedAutomation: string }[];

    // 高效模式 → 应该成为新 skill
    efficientPatterns: { pattern: string; speedup: number; suggestedSkill: string }[];

    // 被忽略的约束 → 应该强化或删除
    ignoredConstraints: { rule: string; violationRate: number; suggestion: 'strengthen' | 'remove' }[];

    // Agent 效率 → 路由优化
    agentEfficiency: { agent: string; successRate: number; avgDuration: number }[];
  };

  // 建议的操作
  suggestedActions: Action[];
}

type Action =
  | { type: 'create_skill'; content: SkillDraft }
  | { type: 'update_constraint'; rule: string; change: string }
  | { type: 'add_hook'; event: string; command: string }
  | { type: 'update_agent_routing'; from: string; to: string; reason: string }
  | { type: 'remove_constraint'; rule: string; reason: string };
```

#### 模块 C：Learner（学习器）

基于分析结果自动执行改进：

```
分析结果
    ↓
高置信度操作（confidence > 85）→ 自动执行
    ├─ 创建新 skill（保存到 .omc/skills/auto/）
    ├─ 更新 constraints.yaml 中的约束
    └─ 调整 agent 路由权重

中置信度操作（60 < confidence < 85）→ 建议用户确认
    ├─ "我注意到 X 错误出现了 5 次，建议添加约束：Y"
    └─ "Agent Z 在这类任务上成功率只有 40%，建议换用 W"

低置信度操作（confidence < 60）→ 仅记录，等待更多数据
```

#### 模块 D：Constraint Updater（约束更新器）

将学到的改进写回约束文件：

```typescript
// 约束更新管道
async function updateConstraints(actions: Action[], projectRoot: string) {
  const constraints = loadConstraints(projectRoot);  // 读取 constraints.yaml

  for (const action of actions) {
    switch (action.type) {
      case 'update_constraint':
        // 修改已有约束
        constraints.rules[action.rule] = action.change;
        break;
      case 'create_skill':
        // 写入新 skill 文件
        writeSkill(action.content, `${projectRoot}/.omc/skills/auto/`);
        break;
      case 'add_hook':
        // 更新 .claude/settings.json 中的 hook
        addHook(action.event, action.command);
        break;
      case 'remove_constraint':
        // 标记为废弃（不直接删除，留审计记录）
        constraints.rules[action.rule].deprecated = true;
        constraints.rules[action.rule].deprecationReason = action.reason;
        break;
    }
  }

  // 重新生成目标格式
  recompileConstraints(constraints, projectRoot);  // → CLAUDE.md, AGENTS.md, etc.

  // 记录变更日志
  appendChangeLog(actions, projectRoot);
}
```

---

## 四、Skill 的三种进化路径

```
路径 1：手动创建（当前已有）
  用户主动运行 /learner → 提取 skill

路径 2：半自动创建（OMC 已有，但不完善）
  Detection Hook 检测到模式 → 提示用户 → 用户确认 → 保存
  Ralph learnings → promotion → 用户确认 → 保存

路径 3：全自动创建（需要新增）
  Analyzer 分析日志 → 识别高价值模式 → 自动创建 draft skill
  → 下次遇到相似场景时自动注入 → 追踪效果 → 效果好则提升 quality score
  → score > 90 提升为正式 skill → score < 30 自动淘汰
```

### Skill 生命周期

```
                 quality score
                     ↑
        100 ─── ┌─────────┐ ← 经典 skill（长期有效）
                │ PROMOTED │
         90 ─── ├─────────┤ ← 自动提升阈值
                │ VERIFIED │ ← 多次成功应用
         70 ─── ├─────────┤ ← 手动创建起始分
                │  ACTIVE  │ ← 正常使用中
         50 ─── ├─────────┤ ← 自动创建起始分
                │  DRAFT   │ ← 自动创建，待验证
         30 ─── ├─────────┤ ← 淘汰阈值
                │ DECLINING│ ← 多次失败
          0 ─── └─────────┘ ← 自动归档
```

### Skill 进化机制

```typescript
interface SkillLifecycle {
  // 使用追踪
  usageCount: number;
  successCount: number;      // 使用后任务成功
  failureCount: number;      // 使用后任务失败
  lastUsed: string;

  // 质量分数（动态更新）
  quality: number;           // 0-100
  trend: 'improving' | 'stable' | 'declining';

  // 版本历史
  versions: {
    version: number;
    content: string;
    changedAt: string;
    reason: string;
  }[];

  // 关联数据
  relatedErrors: string[];   // 此 skill 解决的错误类型
  relatedFiles: string[];    // 此 skill 涉及的文件
  relatedSkills: string[];   // 相关的其他 skill
}
```

---

## 五、跨项目学习

### 本地跨项目

```
~/.dev-harness/
├── global-skills/           # 从所有项目中提取的通用 skill
│   ├── typescript-patterns/
│   ├── python-patterns/
│   └── testing-patterns/
├── project-profiles/        # 每个项目的"指纹"
│   ├── project-a.json       # { stack: "ts+next", patterns: [...] }
│   └── project-b.json
└── transfer-log.json        # 跨项目迁移记录
```

**迁移逻辑**：
```
项目 A 学到 skill S (quality: 95, scope: project)
    ↓
检测到 skill S 不依赖项目特定路径/文件
    ↓
抽象化：去除项目特定引用，保留原理
    ↓
保存到 global-skills/（scope: user）
    ↓
新项目 B init 时：
  - 检测 B 的技术栈
  - 匹配 global-skills/ 中适用的 skill
  - 注入为 draft skill（quality: 50，需要验证）
```

### 社区级学习（远期）

```
开源项目的匿名约束分享
    ↓
"TypeScript + Next.js 项目的 Top 20 约束"
    ↓
新项目 init 时作为推荐模板
```

---

## 六、日志数据结构设计

### 需要收集的日志维度

```yaml
# .dev-harness/logs/execution-log.yaml
version: 1
entries:
  - id: "exec-2026-03-31-001"
    timestamp: "2026-03-31T12:00:00Z"
    task: "Add user authentication"
    duration_seconds: 1200
    outcome: "success"

    # 约束遵守情况
    constraints_checked: 42
    constraints_violated: 2
    violations:
      - rule: "数据库操作必须通过 repository 层"
        file: "src/pages/api/login.ts"
        auto_fixed: true
      - rule: "所有函数必须有返回类型"
        file: "src/lib/auth.ts"
        auto_fixed: true

    # Agent 使用
    agents:
      - name: "executor"
        model: "sonnet"
        calls: 5
        success: 4
        failure: 1
        avg_duration_ms: 8500

    # 工具使用
    tools:
      - name: "Edit"
        calls: 23
        errors: 1
      - name: "Bash"
        calls: 8
        errors: 0

    # 测试结果
    tests:
      before: { total: 45, passed: 45, failed: 0 }
      after:  { total: 52, passed: 52, failed: 0 }
      new_tests_added: 7

    # Review 结果
    review:
      auto_review_passed: true
      issues_found: 1
      issues_fixed: 1

    # 学到的东西
    learnings:
      - "Next.js App Router 中 cookies() 必须在 server component 中调用"
      - "bcrypt 的 saltRounds 在 CI 中用 4（快）生产用 12（安全）"
```

### 聚合分析报告

```yaml
# .dev-harness/reports/weekly-2026-W14.yaml
period: "2026-03-25 to 2026-03-31"
summary:
  total_tasks: 23
  success_rate: 87%
  avg_duration: 15min
  total_constraints_violated: 8
  total_new_skills_created: 3
  total_skills_deprecated: 1

top_violations:
  - rule: "所有函数必须有返回类型"
    count: 4
    suggestion: "考虑添加 PostToolUse hook 自动运行 tsc --noEmit"

top_errors:
  - error: "Cannot find module './types'"
    count: 3
    suggestion: "创建 skill：ESM 模块解析需要 .js 扩展名"

agent_efficiency:
  - agent: "executor (sonnet)"
    tasks: 15
    success: 13
    avg_duration: 12min
  - agent: "executor (opus)"
    tasks: 8
    success: 8
    avg_duration: 22min
    note: "100% 成功率但更慢，建议仅用于复杂任务"

skill_effectiveness:
  - skill: "nextjs-app-router-patterns"
    used: 8
    helped: 7
    quality_change: "+5 (from 75 to 80)"
  - skill: "deprecated-lodash-usage"
    used: 2
    helped: 0
    quality_change: "-20 (from 50 to 30)"
    action: "AUTO_DEPRECATED"
```

---

## 七、实施路径补充

在原有 Phase 1-3 基础上增加：

### Phase 4 (8-12周): 自进化闭环

```
Week 8-9: Observer 模块
  - 在 pipeline runner 中注入日志收集点
  - 定义 ExecutionObservation 数据结构
  - 保存到 .dev-harness/logs/

Week 10-11: Analyzer 模块
  - Session-end hook 触发分析
  - 模式识别：反复错误、反复干预、被忽略的约束
  - 生成改进建议

Week 12: Learner + Constraint Updater
  - 高置信度建议自动执行
  - 中置信度建议提示用户
  - 约束文件自动更新管道
```

### Phase 5 (12-16周): 跨项目学习

```
- 全局 skill 库
- 项目指纹匹配
- 新项目 init 时推荐已有 skill
```

---

## 八、关键设计原则

1. **安全阈值**：自动操作只在高置信度时执行，错误成本低时才自动
2. **可审计**：所有自动变更记录在 changelog 中，用户可以 revert
3. **渐进信任**：新创建的 skill 从低 quality score 开始，需要证明自己
4. **不退化**：Workflow 部分（流程）和 Expertise 部分（知识）分离，知识可以变但流程不轻易变
5. **人在回路**：关键决策（删除约束、改变架构约束）始终需要人确认
