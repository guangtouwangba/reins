# 模块 ⑥：Pipeline Runner（流水线运行器）

## 职责

编排 `/reins develop` 的完整自动开发流程：约束注入 → 规划 → 执行 → 审查 → QA。

**输入**：任务描述 + constraints.yaml + profile
**输出**：完成的代码变更 + 测试 + 执行日志

---

## 流水线架构

```
HARNESS_INIT → RALPLAN → EXECUTION → RALPH → QA
     ↑                                        │
     └────────────── feedback loop ────────────┘
```

| 阶段 | 职责 | 底层依赖 | 可跳过 |
|------|------|---------|--------|
| **HARNESS_INIT** | 将约束注入到后续所有 prompt | constraints.yaml | No |
| **RALPLAN** | 在约束下做任务规划 | OMC ralplan | Yes (relaxed) |
| **EXECUTION** | 在约束下执行编码 | OMC executor | No |
| **RALPH** | Review loop 直到满足退出条件 | OMC ralph | Yes (relaxed) |
| **QA** | lint + typecheck + test | 项目工具链 | Yes (relaxed) |

---

## HARNESS_INIT：约束注入

流水线启动时，将 constraints.yaml 的约束注入到后续所有阶段的 prompt 中。

```typescript
// pipeline/constraint-injector.ts

interface InjectionContext {
  profile: Profile;
  constraints: Constraint[];
  hooks: HookConfig[];
  pipeline: PipelineConfig;
}

function injectConstraints(
  taskDescription: string,
  config: InjectionContext
): string {
  // 按 profile 过滤约束
  const activeConstraints = filterByProfile(config.constraints, config.profile);

  return `
## 任务
${taskDescription}

## 项目约束 (${activeConstraints.length} 条, profile: ${config.profile.name})
${activeConstraints.map(c => `- [${c.severity}] ${c.rule}`).join('\n')}

## 活跃 Hook (违反以下规则会被自动拦截)
${config.hooks.filter(h => h.mode === 'block').map(h => `- ${h.constraintId}: ${h.description}`).join('\n')}

## 流水线配置
${config.pipeline.stages.join(' → ')}
  `;
}

function filterByProfile(constraints: Constraint[], profile: Profile): Constraint[] {
  switch (profile.constraints) {
    case 'all': return constraints;
    case 'critical': return constraints.filter(c => c.severity === 'critical');
    default:
      if (Array.isArray(profile.constraints)) {
        return constraints.filter(c => profile.constraints.includes(c.severity));
      }
      return constraints;
  }
}
```

---

## RALPLAN：约束感知的规划

```typescript
// pipeline/planning.ts

async function plan(
  task: string,
  injectedContext: string,
  context: CodebaseContext
): Promise<Plan> {
  // 规划阶段的额外指令
  const planningPrompt = `
${injectedContext}

## 规划要求
1. 列出需要新建/修改的文件
2. 对每个文件说明遵循哪些约束
3. 标注需要新依赖的地方
4. 生成验证用例 (verification cases)
5. 预估工作量

## 约束感知检查
对计划中的每一步，标注它涉及哪些约束，确保不遗漏。
  `;

  // 同时生成 verification cases
  const plan = await ralplan(planningPrompt);
  await generateVerificationCases(plan, task);
  return plan;
}
```

规划产出：
- 任务分解（步骤列表）
- 文件变更计划
- 约束映射（每步涉及哪些约束）
- Verification cases（供 ⑦ Evaluation 使用）

---

## EXECUTION：约束下的编码

```typescript
// pipeline/execution.ts

async function execute(
  plan: Plan,
  injectedContext: string
): Promise<ExecutionResult> {
  const executionPrompt = `
${injectedContext}

## 执行计划
${formatPlan(plan)}

## 执行要求
- 严格遵循计划中列出的约束
- 每个新文件创建对应测试
- 遇到约束冲突时暂停并报告
  `;

  return await executor(executionPrompt, { model: config.develop.default_model });
}
```

---

## RALPH：约束驱动的 Review Loop

```typescript
// pipeline/review.ts

async function reviewLoop(
  execution: ExecutionResult,
  constraints: Constraint[],
  verificationCases: VerificationCase[]
): Promise<ReviewResult> {
  let iteration = 0;
  const maxIterations = config.evaluation.profiles[profile].max_iterations;

  while (iteration < maxIterations) {
    iteration++;

    // 运行评估系统（模块 ⑦）
    const evalResult = await evaluate(execution, profile);

    // 检查退出条件
    if (shouldExit(evalResult, profile)) {
      return { success: true, iterations: iteration, evalResult };
    }

    // 未通过 → 修复
    const fixes = analyzeFails(evalResult);
    execution = await applyFixes(fixes, injectedContext);
  }

  return { success: false, iterations: iteration, reason: 'max iterations reached' };
}
```

---

## QA：最终质量门禁

```typescript
// pipeline/qa.ts

async function runQA(projectRoot: string): Promise<QAResult> {
  const commands = config.pipeline.pre_commit || [];
  const postCommands = config.pipeline.post_develop || [];
  const allCommands = [...commands, ...postCommands];

  const results: CommandResult[] = [];
  for (const cmd of allCommands) {
    const result = await exec(cmd, { cwd: projectRoot });
    results.push({
      command: cmd,
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
    });

    if (!result.success) break; // 第一个失败就停止
  }

  return {
    passed: results.every(r => r.success),
    results,
  };
}
```

---

## Profile 对流水线的影响

```
strict:
  HARNESS_INIT → RALPLAN → EXECUTION → RALPH(L0+L1+L2+L4) → QA
  全部约束 + 全部 hook + opus model

default:
  HARNESS_INIT → RALPLAN → EXECUTION → RALPH(L0+L1) → QA
  全部约束 + critical+important hook

relaxed:
  HARNESS_INIT → EXECUTION
  仅 critical 约束 + 仅 critical hook
  跳过 planning、review、QA
```

---

## 交互流程示例

```
你：/reins develop "添加用户头像上传功能"

Reins：已加载 11 条项目约束，启动自动开发...

  ── Planning ──────────────────────────────
  基于约束分析任务：
  • 需要新 API route: app/api/avatar/route.ts ← 约束: NextResponse 格式
  • 需要新 service: lib/services/avatar.ts ← 约束: typed results
  • 需要 Prisma migration ← 约束: 不直接写 SQL
  • 需要测试 ← 约束: 同目录 *.test.ts

  计划：4 个文件新建，2 个文件修改，1 个 migration
  继续？[y/n/edit plan]

你：y

  ── Executing ─────────────────────────────
  [1/7] prisma/migrations/add_avatar_field... ✓
  [2/7] lib/services/avatar.ts... ✓
  [3/7] app/api/avatar/route.ts... ✓
       ⚡ 约束检查: NextResponse 格式 ✓
  [4/7] components/AvatarUploader.tsx... ✓
  [5/7-7/7] 测试文件... ✓

  ── Review ────────────────────────────────
  自动检查 11 条约束：
  ✓ TypeScript strict — 无 any
  ✓ Prisma ORM — 无直接 SQL
  ✓ 测试覆盖 — 3/3 新文件有测试

  ── QA ────────────────────────────────────
  pnpm lint ... ✓
  pnpm typecheck ... ✓
  pnpm test ... ✓ (52/52 passed, 3 new)

  ✅ 完成。共新建 4 文件，修改 2 文件，添加 3 个测试。
```

---

## 执行日志

每次 `/reins develop` 执行记录到 `.reins/logs/`：

```yaml
# .reins/logs/executions/2026-03-31-001.yaml
id: "exec-2026-03-31-001"
task: "添加用户头像上传功能"
profile: "default"
duration_seconds: 1200
outcome: "success"

stages:
  planning: { duration: 45s, iterations: 1 }
  execution: { duration: 600s, files_created: 4, files_modified: 2 }
  review: { duration: 300s, iterations: 2, constraint_violations_fixed: 1 }
  qa: { duration: 30s, lint: pass, typecheck: pass, test: "52/52" }

constraints_checked: 42
constraints_violated: 1
violations:
  - rule: "所有函数必须有返回类型"
    file: "src/lib/auth.ts"
    auto_fixed: true

tests:
  before: { total: 49, passed: 49 }
  after: { total: 52, passed: 52, new: 3 }
```

---

## 与 OMC 的桥接

```typescript
// pipeline/omc-bridge.ts

// Reins 不重新实现底层能力，而是桥接 OMC 已有的能力
interface OMCBridge {
  ralplan(prompt: string): Promise<Plan>;     // 规划
  executor(prompt: string, opts: ExecOpts): Promise<ExecutionResult>;  // 执行
  ralph(prompt: string, maxIter: number): Promise<ReviewResult>;       // Review
}
```

**关键洞察**：Reins 是一个**编排层**，把 Claude Code + OMC 已有的能力串联成一个连贯的工作流。Reins 的核心价值在于约束注入，不在于重新实现 agent 调度。

---

## 子模块 & 源码结构

```
src/pipeline/
├── runner.ts                 # 流水线主调度
├── constraint-injector.ts    # 按 profile 注入约束
├── planning.ts               # RALPLAN 阶段
├── execution.ts              # EXECUTION 阶段
├── review.ts                 # RALPH review loop
├── qa.ts                     # QA 质量门禁
└── omc-bridge.ts             # OMC 能力桥接
```

---

## 依赖关系

- **被依赖**：⑧ Self-Improving（日志数据）
- **依赖**：③ Constraint Generator（constraints.yaml）、⑤ Hook System（运行时拦截）、⑦ Evaluation System（退出条件）
- **外部依赖**：OMC（ralplan, executor, ralph）

---

## 实施优先级

- **Phase 2**：runner + constraint-injector + omc-bridge + qa（基础流水线）
- **Phase 3**：planning + review loop + profile 支持
- **Phase 4**：与 Evaluation System 集成
