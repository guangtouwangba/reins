# 模块 ⑧：Self-Improving System（自进化闭环）

## 职责

从运行时日志中学习，持续改进约束和 skill。实现 EXECUTE → OBSERVE → ANALYZE → LEARN → CONSTRAIN 的闭环。

**输入**：执行日志、hook 触发记录、验证结果、人工干预记录
**输出**：新 skill、更新的 constraints.yaml、改进建议

---

## 核心闭环

```
┌─────────────────────────────────────────────────────────┐
│                 自进化 Harness 闭环                       │
│                                                          │
│     ┌──────────┐                                         │
│     │  EXECUTE  │ ← 在约束下执行开发任务                    │
│     └────┬─────┘                                         │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │  OBSERVE  │ ← 收集结构化执行数据                      │
│     └────┬─────┘                                         │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │  ANALYZE  │ ← 自动分析成功/失败模式                   │
│     └────┬─────┘                                         │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │  LEARN    │ ← 提取/进化 skill, 更新约束               │
│     └────┬─────┘                                         │
│          ▼                                               │
│     ┌──────────┐                                         │
│     │ CONSTRAIN │ ← 重新生成约束文件                        │
│     └────┬─────┘                                         │
│          └──────────→ 回到 EXECUTE                        │
└─────────────────────────────────────────────────────────┘
```

---

## 子模块 A：Observer（观察器）

收集结构化执行数据。

```typescript
interface ExecutionObservation {
  sessionId: string;
  taskDescription: string;
  timestamp: string;
  duration: number;
  outcome: 'success' | 'partial' | 'failure';

  // Agent 使用
  agentsUsed: { name: string; model: string; duration: number; success: boolean }[];

  // 工具使用
  toolsUsed: { name: string; count: number; errorRate: number }[];

  // 文件变更
  filesModified: string[];

  // 测试结果
  testsRun: { total: number; passed: number; failed: number };

  // 问题数据
  errors: { type: string; message: string; file?: string; resolution?: string }[];
  retries: { tool: string; count: number; reason: string }[];
  humanInterventions: { reason: string; action: string }[];

  // 约束违反
  constraintViolations: { rule: string; file: string; description: string }[];

  // Review 反馈
  reviewFeedback: { reviewer: string; issues: string[]; approved: boolean }[];

  // 学到的东西
  learnings: string[];
}
```

**数据来源**：
- Pipeline Runner 的执行日志
- Hook 触发记录 (`.reins/logs/hook-health.yaml`)
- Evaluation System 的验证结果
- OMC session replay 数据

---

## 子模块 B：Analyzer（分析器）

定期（session 结束后）分析累积的观察数据。

```typescript
interface AnalysisResult {
  metrics: {
    avgTaskDuration: number;
    successRate: number;
    avgRetries: number;
    humanInterventionRate: number;
  };

  patterns: {
    // 反复出现的错误 → 应该成为新约束
    recurringErrors: {
      error: string;
      frequency: number;
      suggestedConstraint: string;
    }[];

    // 反复的人工干预 → 应该成为新 hook 或约束
    recurringInterventions: {
      reason: string;
      frequency: number;
      suggestedAutomation: string;
    }[];

    // 高效模式 → 应该成为新 skill
    efficientPatterns: {
      pattern: string;
      speedup: number;
      suggestedSkill: string;
    }[];

    // 被忽略的约束 → 应该强化或删除
    ignoredConstraints: {
      rule: string;
      violationRate: number;
      suggestion: 'strengthen' | 'remove';
    }[];

    // Agent 效率
    agentEfficiency: {
      agent: string;
      successRate: number;
      avgDuration: number;
    }[];
  };

  suggestedActions: Action[];
}

type Action =
  | { type: 'create_skill'; content: SkillDraft; confidence: number }
  | { type: 'update_constraint'; rule: string; change: string; confidence: number }
  | { type: 'add_hook'; event: string; command: string; confidence: number }
  | { type: 'update_agent_routing'; from: string; to: string; confidence: number }
  | { type: 'remove_constraint'; rule: string; reason: string; confidence: number };
```

---

## 子模块 C：Learner（学习器）

基于分析结果的置信度分级执行：

```
高置信度（confidence > 85）→ 自动执行
  ├─ 创建新 skill（保存到 .reins/skills/auto/）
  ├─ 更新 constraints.yaml 中的约束
  └─ 调整 agent 路由权重

中置信度（60 < confidence < 85）→ 建议用户确认
  ├─ "我注意到 X 错误出现了 5 次，建议添加约束：Y"
  └─ "Agent Z 在这类任务上成功率只有 40%，建议换用 W"

低置信度（confidence < 60）→ 仅记录，等待更多数据
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

```typescript
interface SkillLifecycle {
  usageCount: number;
  successCount: number;
  failureCount: number;
  lastUsed: string;
  quality: number;           // 0-100
  trend: 'improving' | 'stable' | 'declining';
  versions: {
    version: number;
    content: string;
    changedAt: string;
    reason: string;
  }[];
  relatedErrors: string[];
  relatedFiles: string[];
}
```

### 5 种可检测模式

```typescript
type PatternType =
  | 'problem-solution'   // 问题+解决方案 (confidence: 80)
  | 'technique'          // 有用技巧 (confidence: 70)
  | 'workaround'         // 变通方案 (confidence: 60)
  | 'optimization'       // 优化方法 (confidence: 65)
  | 'best-practice';     // 最佳实践 (confidence: 75)
```

### 质量评分

| 因素 | 分数影响 |
|------|---------|
| 基础分 | 50 |
| 包含文件路径 | +15 |
| 包含错误信息 | +15 |
| 高价值关键词 (error, fix, workaround...) | +5 每个，最多 +20 |
| 重复出现 | +10 每次，最多 +30 |
| 解决方案详细 (>100字) | +10 |
| 通用模式 ("try again", "check docs") | -15 |
| 内容太短 | -20 |
| 缺少触发词 | -25 |

**阈值**：confidence >= 70 才建议提取为 skill。

---

## 子模块 D：Constraint Updater（约束更新器）

将学到的改进写回约束文件。

```typescript
async function updateConstraints(actions: Action[], projectRoot: string) {
  const constraints = loadConstraints(projectRoot);

  for (const action of actions) {
    switch (action.type) {
      case 'update_constraint':
        constraints.rules[action.rule] = action.change;
        break;
      case 'create_skill':
        writeSkill(action.content, `${projectRoot}/.reins/skills/auto/`);
        break;
      case 'add_hook':
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
  recompileConstraints(constraints, projectRoot);
  appendChangeLog(actions, projectRoot);
}
```

---

## Skill 的三种进化路径

```
路径 1：手动创建
  用户主动运行 /reins learn → 提取 skill

路径 2：半自动创建
  Detection Hook 检测到模式 → 提示用户 → 用户确认 → 保存
  Ralph learnings → promotion → 用户确认 → 保存

路径 3：全自动创建
  Analyzer 分析日志 → 识别高价值模式 → 自动创建 draft skill
  → 下次遇到相似场景自动注入 → 追踪效果
  → score > 90 提升为正式 skill
  → score < 30 自动淘汰
```

---

## 跨项目学习

### 本地跨项目

```
~/.dev-harness/
├── global-skills/           # 从所有项目中提取的通用 skill
│   ├── typescript-patterns/
│   ├── python-patterns/
│   └── testing-patterns/
├── project-profiles/        # 每个项目的"指纹"
│   ├── project-a.json
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

## 日志数据结构

```yaml
# .reins/logs/executions/exec-2026-03-31-001.yaml
id: "exec-2026-03-31-001"
timestamp: "2026-03-31T12:00:00Z"
task: "Add user authentication"
duration_seconds: 1200
outcome: "success"

constraints_checked: 42
constraints_violated: 2
violations:
  - rule: "数据库操作必须通过 repository 层"
    file: "src/pages/api/login.ts"
    auto_fixed: true

agents:
  - name: "executor"
    model: "sonnet"
    calls: 5
    success: 4

tests:
  before: { total: 45, passed: 45 }
  after: { total: 52, passed: 52, new: 7 }

learnings:
  - "Next.js App Router 中 cookies() 必须在 server component 中调用"
  - "bcrypt 的 saltRounds 在 CI 中用 4（快）生产用 12（安全）"
```

### 聚合分析报告

```yaml
# .reins/reports/weekly-2026-W14.yaml
period: "2026-03-25 to 2026-03-31"
summary:
  total_tasks: 23
  success_rate: 87%
  avg_duration: 15min

top_violations:
  - rule: "所有函数必须有返回类型"
    count: 4
    suggestion: "考虑添加 PostToolUse hook"

agent_efficiency:
  - agent: "executor (sonnet)"
    tasks: 15
    success: 13
    avg_duration: 12min
  - agent: "executor (opus)"
    tasks: 8
    success: 8
    avg_duration: 22min
    note: "100% 成功率但更慢"

skill_effectiveness:
  - skill: "nextjs-app-router-patterns"
    used: 8
    helped: 7
    quality_change: "+5 (75 → 80)"
  - skill: "deprecated-lodash-usage"
    used: 2
    helped: 0
    quality_change: "-20 (50 → 30)"
    action: "AUTO_DEPRECATED"
```

---

## 事件驱动触发

```
SessionEnd Hook → 轻量过期检查
  → manifest 时间戳 vs 最新文件变化
  → 过期：下次 session 提示 "检测到变化，运行 /reins update？"

PostToolUse:Edit Hook → 约束违反统计
  → 每次 hook 触发记录到 .reins/logs/

Stop Hook → 学习检测
  → 任务完成时分析对话
  → confidence >= 85 自动保存为 draft
  → 60-85 提示用户

git post-merge Hook (可选) → 约束同步
  → pull 后检测 constraints.yaml 变化
  → 提示 "约束已更新"
```

---

## 子模块 & 源码结构

```
src/learn/
├── observer.ts               # 执行数据收集
├── analyzer.ts               # 模式分析
├── learner.ts                # Skill 提取和进化
├── constraint-updater.ts     # 约束更新器
├── scorer.ts                 # 质量评分
├── detector.ts               # 可提取时刻检测
├── promoter.ts               # Skill 提升/淘汰
└── cross-project.ts          # 跨项目学习
```

---

## 依赖关系

- **被依赖**：无（顶层消费者）
- **依赖**：③ Constraint Generator（更新约束后重新生成）、⑥ Pipeline Runner（执行日志）、⑦ Evaluation（验证结果）
- **外部依赖**：OMC session replay（可选复用）

---

## 实施优先级

- **Phase 3**：Observer + /reins learn 手动提取
- **Phase 4**：Analyzer + Learner（半自动）
- **Phase 5**：Constraint Updater + 全自动 + 跨项目学习

---

## 设计原则

1. **安全阈值**：自动操作只在高置信度时执行，错误成本低时才自动
2. **可审计**：所有自动变更记录在 changelog 中，用户可以 revert
3. **渐进信任**：新 skill 从低 quality score 开始，需要证明自己
4. **不退化**：Workflow（流程）和 Expertise（知识）分离，知识可变但流程不轻易变
5. **人在回路**：关键决策（删除约束、改变架构约束）始终需要人确认
