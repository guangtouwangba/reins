# Reins 在 Claude Code 中的交互设计（v2 — 整合架构师 Review）

## 核心原则

- **零配置启动**：`cd` 到任何项目，一条命令开始
- **渐进式**：先探索，再约束，再自动化
- **不打断**：融入现有 Claude Code 工作流，不是另一套系统
- **[v2] 用户可控**：每个自动化行为都可以配置开关和程度
- **[v2] 事件驱动**：Reins 自身也挂在 Hook 上，不只是命令触发

---

## 交互流程

### 命令 1：`/reins init` — 初始化项目

```
你：/reins init

Reins：扫描项目中...

  ✓ 技术栈：TypeScript + Next.js 14 (App Router)
  ✓ 包管理：pnpm
  ✓ 测试：Jest + React Testing Library
  ✓ Lint：ESLint (strict) + Prettier
  ✓ CI：GitHub Actions
  ✓ 架构：App Router + Service Layer + Prisma ORM

  发现 3 个已有约束：
  • tsconfig.json: strict mode ✓
  • .eslintrc: no-any ✓
  • .prettierrc: singleQuote, semi ✓

  从代码模式中推断出 8 条约束：
  1. API routes 在 app/api/ 下，使用 NextResponse
  2. 数据库操作通过 Prisma，不直接写 SQL
  3. 组件用 PascalCase，工具函数用 camelCase
  4. 服务层在 lib/services/，返回 typed results
  5. 测试文件与源文件同目录 (*.test.ts)
  6. 环境变量通过 env.ts 统一管理
  7. 错误处理用自定义 AppError 类
  8. Git commit 遵循 conventional commits

  ⚠ 2 条需要你确认：
  • "组件 props 用 interface 不用 type" — 从 23/25 个组件推断
    [y/n/edit]?
  • "所有 API 都需要 auth middleware" — 从 8/10 个 route 推断
    [y/n/edit]?

你：y, n（第二条有 public API）

Reins：
  ✓ 已生成 .reins/context.json    (项目探索结果)
  ✓ 已生成 .reins/constraints.yaml (11 条约束)
  ✓ 已更新 CLAUDE.md              (注入了项目约束)
  ✓ 已生成 src/AGENTS.md          (源码目录约束)
  ✓ 已生成 lib/AGENTS.md          (库目录约束)

  Reins 已就绪。现在你可以：
  • 正常开发 — 约束会自动生效（通过 CLAUDE.md）
  • /reins develop "任务" — 在约束下全自动开发
  • /reins status — 查看当前约束和统计
```

### 命令 2：`/reins develop` — 在约束下自动开发

```
你：/reins develop "添加用户头像上传功能，支持裁剪和压缩"

Reins：已加载 11 条项目约束，启动自动开发...

  ── Planning ──────────────────────────────
  基于约束分析任务：
  • 需要新 API route: app/api/avatar/route.ts ← 约束: NextResponse 格式
  • 需要新 service: lib/services/avatar.ts ← 约束: typed results
  • 需要 Prisma migration ← 约束: 不直接写 SQL
  • 需要测试 ← 约束: 同目录 *.test.ts
  • 图片处理用 sharp ← 需要新依赖

  计划：4 个文件新建，2 个文件修改，1 个 migration
  继续？[y/n/edit plan]

你：y

  ── Executing ─────────────────────────────
  [1/7] prisma/migrations/add_avatar_field... ✓
  [2/7] lib/services/avatar.ts... ✓
  [3/7] app/api/avatar/route.ts... ✓
       ⚡ 约束检查: NextResponse 格式 ✓
       ⚡ 约束检查: auth middleware ✗ (public API 豁免) ✓
  [4/7] components/AvatarUploader.tsx... ✓
  [5/7] lib/services/avatar.test.ts... ✓
  [6/7] app/api/avatar/route.test.ts... ✓
  [7/7] components/AvatarUploader.test.tsx... ✓

  ── Review ────────────────────────────────
  自动检查 11 条约束：
  ✓ TypeScript strict — 无 any
  ✓ Prisma ORM — 无直接 SQL
  ✓ 测试覆盖 — 3/3 新文件有测试
  ✓ 命名约定 — PascalCase 组件, camelCase 函数
  ✓ 错误处理 — 使用 AppError
  ⚠ 新依赖 sharp — 需要确认

  ── QA ────────────────────────────────────
  pnpm lint ... ✓
  pnpm typecheck ... ✓
  pnpm test ... ✓ (52/52 passed, 3 new)

  ✅ 完成。共新建 4 文件，修改 2 文件，添加 3 个测试。

  📝 学到了 1 条新知识：
  "sharp 在 Next.js 中需要 next.config.js 配置 experimental.serverComponentsExternalPackages"
  保存为 skill？[y/n]
```

### 命令 3：`/reins status` — 查看状态

```
你：/reins status

Reins 状态：
  项目: my-app (TypeScript + Next.js)
  约束: 11 条 (10 自动推断, 1 手动添加)
  Skills: 3 个 (1 自动学到, 2 来自模板)

  最近 5 次执行：
  #  任务                    结果    约束违反  新 skill
  1  添加头像上传             ✅      0        1
  2  修复登录重定向 bug       ✅      1        0
  3  添加邮件通知             ✅      0        0
  4  重构 auth middleware     ✅      0        1
  5  添加 rate limiting      ⚠ 部分  2        0

  约束有效性：
  • "不直接写 SQL" — 遵守率 100%，5/5 次检查通过
  • "同目录测试" — 遵守率 100%
  • "auth middleware" — 遵守率 80%，1 次合理豁免
  • "conventional commits" — 遵守率 60% ⚠ 建议加 hook 强制

  建议：
  • 将 "conventional commits" 约束升级为 pre-commit hook
  • 约束 #7（AppError）可能需要更新 — 最近 2 次被跳过
```

### 命令 4：`/reins update` — 增量更新约束

```
你：/reins update

Reins：检测到上次 init 后的变化...

  新增目录：
  + app/api/webhooks/     (3 个文件)
  + lib/queue/            (2 个文件)

  变化的模式：
  • 发现新模式：webhook routes 不使用 auth middleware（合理）
  • 发现新模式：queue 任务用 async/await + retry wrapper

  建议更新约束：
  1. [新增] "webhook routes 豁免 auth middleware"
  2. [新增] "异步任务使用 lib/queue/retry.ts 的 withRetry 包装"
  3. [更新] 生成 app/api/webhooks/AGENTS.md
  4. [更新] 生成 lib/queue/AGENTS.md

  应用这些更新？[y/n/edit]
```

### 命令 5：`/reins learn` — 手动保存学到的知识

```
你：/reins learn

Reins：分析当前对话...

  检测到 2 个可提取的知识点：
  1. [problem-solution] Prisma 在 Edge Runtime 中不能用，需要用 @prisma/client/edge
     置信度：85%
     触发词：prisma, edge runtime, serverless

  2. [workaround] Next.js revalidatePath 在 route handler 中不生效，需要用 revalidateTag
     置信度：78%
     触发词：revalidatePath, route handler, cache

  保存哪些？[1/2/all/none]

你：all

  ✓ 已保存到 .reins/skills/prisma-edge-runtime.md
  ✓ 已保存到 .reins/skills/nextjs-revalidate-workaround.md
  下次遇到类似场景会自动应用。
```

### 被动模式：约束自动生效

即使不用 `/reins develop`，正常使用 Claude Code 时约束也通过 CLAUDE.md 生效：

```
你：帮我在 user profile 页面加一个编辑功能

Claude：（内部读取了 CLAUDE.md 中的 Reins 约束）

  我会遵循项目约束来实现：
  • 创建 lib/services/profile.ts（service 层，返回 typed result）
  • 创建 app/api/profile/route.ts（使用 NextResponse + auth middleware）
  • 使用 Prisma 更新用户数据
  • 创建对应的测试文件
  ...
```

---

## 文件结构

```
项目根目录/
├── .reins/                          # Reins 工作目录
│   ├── context.json                 # 探索结果（机器可读）
│   ├── constraints.yaml             # 约束配置（可编辑）
│   ├── manifest.json                # 目录快照（增量更新用）
│   ├── skills/                      # 学到的项目知识
│   │   ├── prisma-edge-runtime.md
│   │   └── nextjs-revalidate.md
│   └── logs/                        # 执行日志
│       └── 2026-03-31.yaml
│
├── CLAUDE.md                        # ← Reins 注入约束到这里
├── src/AGENTS.md                    # ← Reins 生成
├── lib/AGENTS.md                    # ← Reins 生成
└── ...
```

---

## 实现形式

在 Claude Code 中，Reins 作为一组 **Skills** 实现：

```
~/.claude/skills/reins/
├── SKILL.md              # 主 skill（/reins init）
├── develop.md            # /reins develop
├── status.md             # /reins status
├── update.md             # /reins update
└── learn.md              # /reins learn
```

或者作为 **OMC 的 skill 扩展**：

```
/oh-my-claudecode:reins-init
/oh-my-claudecode:reins-develop
/oh-my-claudecode:reins-status
/oh-my-claudecode:reins-update
/oh-my-claudecode:reins-learn
```

---

## 与现有 Claude Code 功能的关系

| Reins 命令 | 底层依赖 |
|-----------|---------|
| `/reins init` | Explore agent + Glob/Grep + Read + Write (生成 CLAUDE.md) |
| `/reins develop` | OMC autopilot pipeline (RALPLAN → EXEC → RALPH → QA) + 约束注入 |
| `/reins status` | 读取 .reins/logs/ + constraints.yaml |
| `/reins update` | deepinit-manifest diff 逻辑 + LLM 模式分析 |
| `/reins learn` | OMC learner detection + skill writer |

**关键洞察**：Reins 不需要重新实现底层能力，它是一个**编排层**，把 Claude Code + OMC 已有的能力串联成一个连贯的工作流。

---

## [v2 新增] 改进的交互流程

### `/reins init` 改进：扫描深度 + 合并策略 + dry-run

```
你：/reins init --depth L0-L1    # 快速浅扫（spike 项目）
你：/reins init                   # 默认 L0-L2（标准）
你：/reins init --depth L0-L5    # 深度扫描（含 AST + git 历史 + LLM）

# 在已有 .reins/ 的项目上：
你：/reins init                   # 默认 merge：保留用户修改 + 添加新检测
你：/reins init --force           # 全部重新生成
你：/reins init --diff            # 仅预览差异
```

```
你：/reins init

Reins：检测到已有 .reins/ 配置（上次 init: 2026-03-25）

  扫描变化...
  • 新增目录: app/api/webhooks/ (3 文件)
  • 新增依赖: sharp, zod
  • 删除目录: lib/legacy/ (已不存在)

  建议操作：
  ┌──────────────────────────────────────────────────────┐
  │ 操作          约束                        类型       │
  │ [保留]       "数据库通过 Prisma"           用户确认过 │
  │ [保留]       "API 用 NextResponse"         用户确认过 │
  │ [新增]       "webhook 豁免 auth"           新检测     │
  │ [新增]       "zod 做输入验证"              新检测     │
  │ [废弃]       "legacy 模块需要兼容处理"     目录已删除 │
  └──────────────────────────────────────────────────────┘

  应用？[y/n/edit]
```

### `/reins develop` 改进：Profile + 跳过阶段

```
你：/reins develop "添加支付功能"
  → 使用默认 profile，全流程 PLAN→EXEC→REVIEW→QA

你：/reins develop --profile strict "安全相关重构"
  → 全部约束 + 全部 hook + opus model

你：/reins develop --profile relaxed "快速原型给老板看"
  → 仅 critical 约束 + 跳过 planning 和 QA

你：/reins develop --skip qa "修复 README 链接"
  → 默认约束但跳过 QA 阶段

你：/reins develop --dry-run "添加搜索功能"
  → 仅生成计划，不执行任何代码变更
```

```
你：/reins develop --profile relaxed "快速搭个 demo"

Reins：⚡ Relaxed 模式 — 仅 critical 约束，跳过 planning 和 QA

  约束加载：3/11（仅 critical）
  Hook 加载：2/5（仅 critical）
  流水线：EXEC only

  ── Executing ─────────────────────────────
  [1/3] lib/services/demo.ts... ✓
  [2/3] app/demo/page.tsx... ✓
  [3/3] app/api/demo/route.ts... ✓
       ⚡ 约束检查 (critical only): 3/3 ✓

  ✅ 完成（跳过了 planning, review, qa）
  ⚠ 提示：relaxed 模式下未运行测试，正式提交前建议 /reins develop --profile strict
```

### `/reins status` 改进：过滤 + 格式 + 趋势

```
你：/reins status                          # 默认概览
你：/reins status --filter critical        # 仅看 critical 约束
你：/reins status --format json            # JSON 输出（CI 用）
你：/reins status --since 7d              # 最近 7 天的趋势
你：/reins status --compare 14d           # 对比 14 天前后的变化
```

```
你：/reins status --since 7d

Reins 状态（最近 7 天）：
  项目: my-app | 约束: 11 条 | Skills: 3 个

  趋势：
  成功率   ██████████░  90% (↑ 5% vs 上周)
  约束遵守 █████████░░  85% (↑ 10%)
  平均耗时 ████████░░░  12min (↓ 3min, 更快了)

  ⚠ 告警：
  • Hook "post-edit-check.sh" 最近 3 次意外错误（jq not found）
    → 建议: 安装 jq 或运行 /reins hook fix

  • 约束 "conventional commits" 遵守率仅 60%
    → 建议: 升级为 pre-commit hook？[y/n]

  • 约束 "legacy 兼容" 引用了已删除的 lib/legacy/ 目录
    → 建议: 运行 /reins update 清理过期约束

  💡 改进建议可直接执行：
  /reins hook fix                    # 修复坏 hook
  /reins update                      # 清理过期约束
  /reins hook promote conventional   # 升级约束为 hook
```

### [v2 新增] `/reins test` — 测试约束和 Hook 有效性

```
你：/reins test

Reins：运行约束测试套件...

  ── Hook 健康检查 ─────────────────────────
  ✓ post-edit-check.sh      (23ms, exit 0)
  ✓ bash-guard.sh           (12ms, exit 0)
  ✓ pre-complete-check.sh   (145ms, exit 0)
  ✗ context-inject.sh       (err: jq not found)

  ── 合成违规测试 ──────────────────────────
  ✓ 直接 SQL → post-edit-check 正确拦截 (exit 2)
  ✓ process.env → post-edit-check 正确拦截 (exit 2)
  ✓ force push → bash-guard 正确拦截 (exit 2)
  ⚠ 缺少测试文件 → pre-complete-check 未触发（需要 git staged files）

  结果: 3/4 Hook 健康, 3/4 约束可执行
  ⚠ 修复: 安装 jq (brew install jq) 后重新测试
```

### [v2 新增] `/reins rollback` — 回滚约束变更

```
你：/reins rollback

Reins：约束变更历史：

  #  时间                操作
  1  2026-03-31 14:00   /reins update — 新增 2 条约束, 废弃 1 条
  2  2026-03-30 10:00   /reins hook add "no-lodash"
  3  2026-03-28 16:00   /reins init --merge

  回滚到哪个版本？[1/2/3/cancel]

你：1

Reins：
  ✓ 已回滚到 2026-03-30 10:00 的约束状态
  ✓ 已恢复 constraints.yaml
  ✓ 已恢复 CLAUDE.md
  ✓ 已恢复 2 个 AGENTS.md 文件
  ⚠ Hook 脚本已恢复（context-inject.sh 的 jq 问题仍存在）
```

### [v2 新增] 事件驱动的自动行为

这些行为通过 Claude Code Hook 自动触发，不需要用户手动运行：

```
SessionEnd Hook → 轻量过期检查
  → 检测 manifest 时间戳 vs 最新文件变化
  → 如果过期：在下次 session 开始时提示 "检测到 3 处变化，运行 /reins update？"

PostToolUse:Edit Hook → 约束违反统计
  → 每次 hook 触发（无论 block 还是 pass）记录到 .reins/logs/
  → 供 /reins status 使用

Stop Hook → 学习检测
  → 任务完成时分析对话，检测可提取的 skill
  → confidence >= 85 自动保存为 draft
  → 60-85 提示用户

git post-merge Hook (可选安装) → 约束同步
  → 团队成员 pull 后，检测 constraints.yaml 是否有变化
  → 如果有：提示 "约束已更新，请查看 /reins status"
```

配置（在 .reins/config.yaml 中）：
```yaml
update:
  auto_trigger: "session_end"  # manual = 关闭所有自动触发
  staleness_check: true

learn:
  auto_extract_threshold: 85   # 设为 100 = 永远不自动提取
  suggestion_threshold: 60     # 设为 100 = 永远不提示

hooks:
  health_check: true           # false = 不自动禁用坏 hook
```

每个自动行为都可以在 config.yaml 中关闭。
