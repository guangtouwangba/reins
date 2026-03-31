# Reins 渐进式上下文设计

## 核心发现

### OpenAI："给地图，不给手册"

> "One giant agent manual quickly becomes stale and unhelpful."
> "A map of the whole city doesn't tell you which building to walk into."

OpenAI 的做法：AGENTS.md 是**短小的导航图**，指向 `docs/` 目录中的详细知识库。Agent 通过 glob/grep 自主导航，而不是预加载所有内容。

### Anthropic："最小高信号 token 集"

> "Find the smallest set of high-signal tokens that maximize the likelihood of some desired outcome."

策略：维护轻量标识符（文件路径、查询、链接），运行时动态检索，让 agent 自主探索。

### OpenViking：L0/L1/L2 三层模型

| 层级 | 大小 | 加载条件 | 查询占比 |
|------|------|---------|---------|
| **L0 (抽象)** | ~100 tokens | 始终加载，用于搜索匹配 | 100% |
| **L1 (概览)** | 1-2K tokens | L0 命中时加载 | ~88% |
| **L2 (详细)** | 完整内容 | 仅深度分析时 | ~12% |

**实测数据**：92.9% token 减少，92.9% 成本降低，任务完成率 91-96%。

### Manus：百万用户的教训

1. **KV-Cache 命中率是最关键指标** — 维护稳定的 prompt 前缀
2. **文件系统是无限持久化内存** — 把上下文写入文件，需要时再读
3. **保留错误信号** — 失败记录帮助 agent 隐式更新认知
4. **复述防遗忘** — 创建/更新 todo 文件，把目标推入最近注意力范围

---

## 之前的设计问题

原来的 `/reins init` 把所有约束塞进 CLAUDE.md：

```markdown
# CLAUDE.md (原设计 — 有问题)
## 技术栈
TypeScript + Next.js 14 (App Router)...

## 约束 (11条全部列在这里)
1. API routes 在 app/api/ 下...
2. 数据库操作通过 Prisma...
3. 组件用 PascalCase...
...11条全部平铺
```

**问题**：
- 占用了宝贵的"始终加载"上下文预算（CLAUDE.md 建议 < 300 行 / ~100 条指令）
- 不相关的约束稀释了相关约束的注意力
- 随着约束增长，CLAUDE.md 会变得臃肿
- 不同目录下工作时，大部分约束是无关的

---

## 新设计：三层渐进式上下文

```
┌─────────────────────────────────────────────────────────┐
│              Reins 渐进式上下文架构                       │
│                                                          │
│  Layer 0: Map (始终加载)                                  │
│  ┌─────────────────────────────────────────────┐         │
│  │ CLAUDE.md — 项目地图 + 导航指令               │         │
│  │ • 项目是什么（1-2句）                         │         │
│  │ • 技术栈（1行）                               │         │
│  │ • 关键命令（build/test/lint）                  │         │
│  │ • "约束详见 .reins/，目录约束见各 AGENTS.md"   │         │
│  │ • 3-5 条最关键的全局约束                       │         │
│  │ 目标：< 50 行                                 │         │
│  └─────────────────────────────────────────────┘         │
│                         ↓ 进入目录时                      │
│  Layer 1: Navigation (按需加载)                           │
│  ┌─────────────────────────────────────────────┐         │
│  │ src/AGENTS.md — 这个目录的约束和导航           │         │
│  │ lib/AGENTS.md — 这个目录的约束和导航           │         │
│  │ • 这个目录做什么                               │         │
│  │ • 这个目录特有的 3-5 条约束                    │         │
│  │ • 关键文件列表                                │         │
│  │ • "详细模式和示例见 .reins/patterns/"          │         │
│  │ 目标：每个 < 30 行                            │         │
│  └─────────────────────────────────────────────┘         │
│                         ↓ 需要深入时                      │
│  Layer 2: Detail (主动检索)                               │
│  ┌─────────────────────────────────────────────┐         │
│  │ .reins/patterns/api-patterns.md              │         │
│  │ .reins/patterns/testing-patterns.md          │         │
│  │ .reins/patterns/error-handling.md            │         │
│  │ .reins/skills/prisma-edge-runtime.md         │         │
│  │ • 完整的代码示例                               │         │
│  │ • 详细的 do/don't 说明                        │         │
│  │ • 具体文件的模式参考                           │         │
│  │ 目标：agent 通过 grep/read 按需获取            │         │
│  └─────────────────────────────────────────────┘         │
│                                                          │
│  Layer ∞: Source (永远不预加载)                            │
│  ┌─────────────────────────────────────────────┐         │
│  │ 源代码、git 历史、测试文件、第三方文档          │         │
│  │ → agent 用工具自主检索                        │         │
│  └─────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
```

---

## 具体产出物设计

### Layer 0：CLAUDE.md（< 50 行）

```markdown
# My App

Next.js 14 (App Router) + TypeScript + Prisma + pnpm

## Commands
- `pnpm dev` — 启动开发服务器
- `pnpm test` — 运行测试 (Jest)
- `pnpm lint` — ESLint + Prettier
- `pnpm typecheck` — tsc --noEmit

## Critical Rules (违反这些会导致严重问题)
- 数据库操作必须通过 Prisma，不直接写 SQL
- 所有 API routes 使用 NextResponse 格式
- 环境变量通过 lib/env.ts 统一管理，不直接用 process.env

## Project Map
- `app/` — 页面和 API routes
- `lib/services/` — 业务逻辑层
- `lib/repositories/` — 数据访问层
- `components/` — React 组件
- `.reins/` — 项目约束和知识库 (详见 .reins/README.md)

## Reins
本项目使用 Reins 管理开发约束。
- 完整约束列表: `.reins/constraints.yaml`
- 目录级约束: 各目录下的 `AGENTS.md`
- 代码模式参考: `.reins/patterns/`
- 学到的知识: `.reins/skills/`
```

**注意**：只有 3-5 条"违反会导致严重问题"的约束放在 L0。其他约束下沉到 L1/L2。

### Layer 1：目录级 AGENTS.md（每个 < 30 行）

```markdown
# app/api/ — API Routes

## Purpose
RESTful API 端点，处理客户端请求。

## Rules for This Directory
- 每个 route 使用 NextResponse.json() 返回
- 除 /api/webhooks/ 和 /api/health 外，所有 route 需要 auth middleware
- 错误处理使用 lib/errors.ts 的 AppError

## Key Files
- route.ts — 路由处理器
- middleware.ts — auth + rate limiting

## Patterns
详见 .reins/patterns/api-patterns.md
```

```markdown
# lib/services/ — Service Layer

## Purpose
业务逻辑层，被 API routes 调用。

## Rules for This Directory
- 每个 service 返回 typed Result<T, Error>，不抛异常
- 每个 service 必须有同目录的 *.test.ts
- 不直接导入 @prisma/client，通过 repositories 层访问数据

## Key Files
- auth.ts — 认证逻辑
- user.ts — 用户管理
- avatar.ts — 头像处理

## Patterns
详见 .reins/patterns/service-patterns.md
```

### Layer 2：`.reins/patterns/` 目录（按需检索）

```markdown
# .reins/patterns/api-patterns.md

## Route Handler 标准模板

```typescript
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/auth';
import { userService } from '@/lib/services/user';
import { AppError } from '@/lib/errors';

export const GET = withAuth(async (req: NextRequest) => {
  const result = await userService.list();

  if (result.isErr()) {
    throw new AppError(result.error.message, 500);
  }

  return NextResponse.json({ data: result.value });
});
```

## 常见错误

### ❌ 直接在 route 中访问数据库
```typescript
// BAD
import { prisma } from '@/lib/prisma';
export async function GET() {
  const users = await prisma.user.findMany(); // 违反分层约束
}
```

### ✅ 通过 service 层
```typescript
// GOOD
import { userService } from '@/lib/services/user';
export async function GET() {
  const result = await userService.list(); // 通过 service 层
}
```

## Auth Middleware 豁免列表
以下路径不需要 auth middleware：
- `/api/webhooks/*` — 第三方回调
- `/api/health` — 健康检查
- `/api/auth/login` — 登录端点
- `/api/auth/register` — 注册端点
```

### Layer ∞：不预加载，agent 自主检索

- 源代码 → `Read` 工具
- Git 历史 → `Bash(git log)`
- 测试文件 → `Glob(**/*.test.ts)` + `Read`
- 第三方文档 → `WebFetch` / `WebSearch`
- 依赖信息 → `Read(package.json)`

---

## Init 流程改进

### 旧流程（一次性生成）

```
扫描 → 推断所有约束 → 全部写入 CLAUDE.md
```

### 新流程（渐进式生成）

```
/reins init

Phase 1: 快速扫描（< 5秒，确定性，无 AI）
├── 检测技术栈 (package.json/go.mod/etc.)
├── 检测已有约束 (eslint/prettier/tsconfig)
├── 扫描目录结构
└── 输出: .reins/context.json

Phase 2: 分层约束生成
├── 对约束按重要性排序：
│   ├── Critical (违反会 break build) → L0 (CLAUDE.md)
│   ├── Important (影响架构一致性) → L1 (AGENTS.md)
│   └── Helpful (编码风格/偏好) → L2 (.reins/patterns/)
│
├── 生成 L0: CLAUDE.md
│   • 项目摘要（2行）
│   • 关键命令（4-5行）
│   • 3-5 条 Critical 约束（10行）
│   • 项目地图（5-8行）
│   • Reins 导航指引（3行）
│   = 共约 30-50 行
│
├── 生成 L1: 各目录 AGENTS.md
│   • 每个目录的角色（1行）
│   • 该目录特有的约束（3-5条）
│   • 关键文件列表
│   • 指向 L2 的引用
│   = 每个约 20-30 行
│
└── 生成 L2: .reins/patterns/
    • 每个主题一个 markdown 文件
    • 包含代码示例、do/don't
    • Agent 通过 grep 按需发现
    = 每个文件可以很长，因为不预加载

Phase 3: 用户确认
├── 展示 L0 内容（最重要的 3-5 条约束）
├── 让用户审查/编辑
└── 保存
```

### 约束分级标准

```
Critical (→ L0, 始终可见):
├── 违反会导致 build 失败的
├── 违反会导致数据丢失/安全问题的
├── 项目最核心的架构决策
└── 示例："数据库操作必须通过 Prisma"

Important (→ L1, 进入目录时可见):
├── 目录级的架构规则
├── 该模块特有的编码规范
├── 测试要求
└── 示例："service 返回 Result<T, Error>"

Helpful (→ L2, 需要时检索):
├── 代码模板和示例
├── 常见错误和解决方案
├── 最佳实践参考
└── 示例："Route Handler 标准模板"
```

---

## 文件结构（更新版）

```
项目根目录/
├── CLAUDE.md                    ← L0: 地图 + 关键命令 + 3-5条核心约束 (< 50行)
│
├── app/
│   ├── AGENTS.md                ← L1: app 目录的角色和约束
│   └── api/
│       └── AGENTS.md            ← L1: API 目录的角色和约束
├── lib/
│   ├── AGENTS.md                ← L1: lib 目录的角色和约束
│   └── services/
│       └── AGENTS.md            ← L1: services 目录的角色和约束
├── components/
│   └── AGENTS.md                ← L1: components 目录的角色和约束
│
└── .reins/
    ├── README.md                # Reins 使用说明（给人看的）
    ├── context.json             # 探索结果（给机器看的）
    ├── constraints.yaml         # 完整约束列表 + 分级标记
    ├── manifest.json            # 目录快照（增量更新用）
    ├── patterns/                ← L2: 详细模式参考
    │   ├── api-patterns.md
    │   ├── service-patterns.md
    │   ├── testing-patterns.md
    │   ├── error-handling.md
    │   └── component-patterns.md
    ├── skills/                  # 学到的项目知识
    │   └── ...
    └── logs/                    # 执行日志
        └── ...
```

---

## Token 预算

基于 OpenViking 的实测数据和 Anthropic 的建议：

| 层级 | 单层大小 | 加载时机 | 预估 token |
|------|---------|---------|-----------|
| L0 | 30-50 行 | 每次 session | ~500-800 |
| L1 | 20-30 行/目录 | 进入目录时 | ~300-500/目录 |
| L2 | 不限 | grep/read 按需 | 按需 |
| 合计（典型场景） | | | ~1,000-2,000 |

对比原设计（所有约束平铺在 CLAUDE.md）：~3,000-5,000 tokens

**节省 50-70% 的始终加载上下文**，同时约束覆盖率不降低。

---

## 关键设计原则

1. **L0 是地图，不是手册** — 告诉 agent 哪里找信息，不是把信息全给它
2. **约束按"违反成本"分级** — 越危险的约束越要放在高层级
3. **L2 是可 grep 的知识库** — Agent 自主通过 `Grep(".reins/patterns/", "route handler")` 检索
4. **文件系统即内存** — 把详细上下文写入文件，需要时读取，而不是预加载
5. **AGENTS.md 只写该目录的约束** — 不重复父级约束，利用层级继承

---

## 参考来源

- OpenAI: "Give a map, not a manual" — https://openai.com/index/harness-engineering/
- Anthropic: "Smallest high-signal token set" — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- OpenViking L0/L1/L2: 92.9% token reduction — https://docs.bswen.com/blog/2026-03-16-openviking-context-layers-l0-l1-l2/
- Manus: KV-cache + filesystem as memory — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Lazy Tool Discovery: 96% token reduction — https://tanstack.com/blog/tanstack-ai-lazy-tool-discovery
- Cursor: Dynamic Context Discovery — https://cursor.com/blog/dynamic-context-discovery
- Cognition SWE-grep: Parallel retrieval — https://cognition.ai/blog/swe-grep
- CodeDelegator: Preventing context pollution — https://arxiv.org/html/2601.14914v1
- Progressive Disclosure for AI Agents — https://www.honra.io/articles/progressive-disclosure-for-ai-agents
