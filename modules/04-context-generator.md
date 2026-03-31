# 模块 ④：Progressive Context Generator（渐进式上下文生成器）

## 职责

将约束按三层模型（L0/L1/L2）分发到不同文件，控制 token 预算，实现"给地图，不给手册"。

**输入**：`constraints.yaml`（来自 ③ Constraint Generator）
**输出**：CLAUDE.md (L0) + 各目录 AGENTS.md (L1) + .reins/patterns/*.md (L2)

---

## 核心设计：三层渐进式上下文

```
┌─────────────────────────────────────────────────────────┐
│  Layer 0: Map (始终加载)                                  │
│  ┌─────────────────────────────────────────────┐         │
│  │ CLAUDE.md — 项目地图 + 导航指令               │         │
│  │ • 项目是什么（1-2句）                         │         │
│  │ • 技术栈（1行）                               │         │
│  │ • 关键命令（build/test/lint）                  │         │
│  │ • 3-5 条 Critical 约束                       │         │
│  │ • 导航指引："约束详见 .reins/"                 │         │
│  │ 目标：< 50 行 / ~500-800 tokens              │         │
│  └─────────────────────────────────────────────┘         │
│                         ↓ 进入目录时                      │
│  Layer 1: Navigation (按需加载)                           │
│  ┌─────────────────────────────────────────────┐         │
│  │ 各目录 AGENTS.md                             │         │
│  │ • 这个目录做什么（1行）                       │         │
│  │ • 这个目录特有的 3-5 条约束                    │         │
│  │ • 关键文件列表                                │         │
│  │ • "详细模式见 .reins/patterns/"               │         │
│  │ 目标：每个 < 30 行 / ~300-500 tokens          │         │
│  └─────────────────────────────────────────────┘         │
│                         ↓ 需要深入时                      │
│  Layer 2: Detail (主动检索)                               │
│  ┌─────────────────────────────────────────────┐         │
│  │ .reins/patterns/*.md                         │         │
│  │ • 完整代码示例                                │         │
│  │ • do/don't 说明                              │         │
│  │ • 具体模式参考                                │         │
│  │ 目标：agent 通过 grep/read 按需获取            │         │
│  └─────────────────────────────────────────────┘         │
│                                                          │
│  Layer ∞: Source (永远不预加载)                            │
│  │ 源代码、git 历史、测试文件 → agent 用工具自主检索  │         │
└─────────────────────────────────────────────────────────┘
```

---

## 分级标准

| 级别 | 目标层 | 标准 | 示例 |
|------|--------|------|------|
| **Critical** | L0 | 违反会导致 build 失败 / 数据丢失 / 安全问题 | "数据库操作必须通过 Prisma" |
| **Important** | L1 | 目录级架构规则、测试要求 | "service 返回 Result<T, Error>" |
| **Helpful** | L2 | 代码模板、do/don't、最佳实践 | "Route Handler 标准模板" |

---

## L0 生成：CLAUDE.md

```typescript
// context/l0-generator.ts

function generateL0(
  projectRoot: string,
  context: CodebaseContext,
  constraints: Constraint[]
): string {
  const criticalConstraints = constraints.filter(c => c.severity === 'critical');
  // 最多 5 条，超过则取最重要的
  const topConstraints = criticalConstraints.slice(0, 5);

  return `# ${context.project.name}

${context.stack.framework.join(' + ')} + ${context.stack.primary_language} + ${context.stack.package_manager}

## Commands
- \`${context.stack.packageManager} dev\` — 启动开发服务器
- \`${context.stack.packageManager} test\` — 运行测试 (${context.testing.framework})
- \`${context.stack.packageManager} lint\` — ESLint + Prettier
- \`${context.stack.packageManager} typecheck\` — tsc --noEmit

## Critical Rules (违反这些会导致严重问题)
${topConstraints.map(c => `- ${c.rule}`).join('\n')}

## Project Map
${generateProjectMap(context.structure)}

## Reins
本项目使用 Reins 管理开发约束。
- 完整约束列表: \`.reins/constraints.yaml\`
- 目录级约束: 各目录下的 \`AGENTS.md\`
- 代码模式参考: \`.reins/patterns/\`
- 学到的知识: \`.reins/skills/\`
`;
}
```

**硬性限制**：< 50 行。

---

## L1 生成：目录级 AGENTS.md

```typescript
// context/l1-generator.ts

interface DirectoryProfile {
  path: string;           // "lib/services/"
  purpose: string;        // 从目录名和文件内容推断
  constraints: Constraint[];  // severity=important，scope 匹配此目录
  keyFiles: string[];
  patternRef: string;     // 指向 L2 的引用
}

function generateL1(
  projectRoot: string,
  constraints: Constraint[],
  directories: DirectoryProfile[]
): void {
  for (const dir of directories) {
    const dirConstraints = constraints.filter(c =>
      c.severity === 'important' &&
      (c.scope === 'global' || c.scope === `directory:${dir.path}`)
    );

    // 每个目录最多 5 条约束
    const content = `# ${dir.path} — ${dir.purpose}

## Purpose
${dir.purpose}

## Rules for This Directory
${dirConstraints.slice(0, 5).map(c => `- ${c.rule}`).join('\n')}

## Key Files
${dir.keyFiles.map(f => `- ${f}`).join('\n')}

## Patterns
详见 .reins/patterns/${dir.patternRef}
`;

    writeFile(`${projectRoot}/${dir.path}/AGENTS.md`, content);
  }
}
```

**硬性限制**：每个 < 30 行。

**哪些目录需要生成 AGENTS.md**：
- 架构层目录（`app/`, `lib/`, `components/`, `services/`）
- 有独立约束的子目录（`app/api/`, `lib/repositories/`）
- 不对叶子目录或纯文件目录生成

---

## L2 生成：.reins/patterns/

```typescript
// context/l2-generator.ts

interface PatternDocument {
  filename: string;       // "api-patterns.md"
  topic: string;          // "API Route 开发模式"
  constraints: Constraint[];  // severity=helpful
  examples: CodeExample[];
  dosDonts: DosDonts[];
}

function generateL2(
  projectRoot: string,
  constraints: Constraint[],
  context: CodebaseContext
): void {
  // 按主题分组
  const groups = groupConstraintsByTopic(constraints.filter(c => c.severity === 'helpful'));

  for (const [topic, group] of groups) {
    const content = `# ${topic}

${group.map(c => formatConstraintWithExample(c)).join('\n\n---\n\n')}
`;
    writeFile(`${projectRoot}/.reins/patterns/${topic}.md`, content);
  }
}
```

L2 文件**不受行数限制**，因为不会被预加载。Agent 通过 grep 按需检索。

### L2 文件示例

```markdown
# .reins/patterns/api-patterns.md

## Route Handler 标准模板

```typescript
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/auth';
import { userService } from '@/lib/services/user';

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
const users = await prisma.user.findMany(); // 违反分层约束
```

### ✅ 通过 service 层
```typescript
// GOOD
const result = await userService.list();
```

## Auth Middleware 豁免列表
- `/api/webhooks/*` — 第三方回调
- `/api/health` — 健康检查
```

---

## Token 预算

| 层级 | 单层大小 | 加载时机 | 预估 token |
|------|---------|---------|-----------|
| L0 | 30-50 行 | 每次 session | ~500-800 |
| L1 | 20-30 行/目录 | 进入目录时 | ~300-500/目录 |
| L2 | 不限 | grep/read 按需 | 按需 |
| 合计（典型场景） | | | ~1,000-2,000 |

对比原设计（所有约束平铺在 CLAUDE.md）：~3,000-5,000 tokens

**节省 50-70% 的始终加载上下文**，同时约束覆盖率不降低。

---

## 设计原则

1. **L0 是地图，不是手册** — 告诉 agent 哪里找信息，不是把信息全给它
2. **约束按"违反成本"分级** — 越危险的约束越要放在高层级
3. **L2 是可 grep 的知识库** — Agent 通过 `Grep(".reins/patterns/", "route handler")` 检索
4. **文件系统即内存** — 详细上下文写入文件，需要时读取
5. **AGENTS.md 只写该目录的约束** — 不重复父级约束，利用层级继承

---

## 子模块 & 源码结构

```
src/context/
├── l0-generator.ts           # CLAUDE.md 生成
├── l1-generator.ts           # 目录 AGENTS.md 生成
├── l2-generator.ts           # .reins/patterns/*.md 生成
└── index.ts                  # 统一入口
```

---

## 依赖关系

- **被依赖**：⑤ Hook System（context-inject hook 引用 L2 文件路径）
- **依赖**：③ Constraint Generator（constraints.yaml）
- **外部依赖**：无

---

## 实施优先级

- **MVP**：L0 + L1 生成
- **Phase 2**：L2 生成 + 模板化

---

## 理论基础

- **OpenAI**："Give a map, not a manual" — AGENTS.md 是短小导航图
- **Anthropic**："Smallest high-signal token set" — 最小高信号 token 集
- **OpenViking**：L0/L1/L2 三层模型 — 92.9% token 减少，91-96% 任务完成率
- **Manus**：KV-Cache 命中率是最关键指标 + 文件系统是无限持久化内存
