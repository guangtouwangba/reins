# 模块 ③：Constraint Generator（约束生成器）

## 职责

从 Scanner 的扫描结果生成结构化约束，输出规范中间格式 `constraints.yaml`，并通过 Adapter 层转换为多种 AI 工具可消费的格式。

**输入**：CodebaseContext（来自 ② Scanner）
**输出**：`constraints.yaml`（中间格式）→ 多格式约束文件

---

## 核心数据格式：constraints.yaml

```yaml
# .reins/constraints.yaml — 约束配置的核心格式
version: 1
generated_at: "2026-03-31T12:00:00Z"
project:
  name: "my-app"
  type: "web-fullstack"

stack:
  primary_language: "typescript"
  framework: "next.js"
  test_framework: "jest"
  package_manager: "pnpm"

constraints:
  - id: "no-direct-sql"
    rule: "数据库操作必须通过 Prisma，不直接写 SQL"
    severity: critical          # critical | important | helpful
    scope: global               # global | directory:<path>
    source: auto                # auto | manual | learned
    enforcement:
      soft: true                # → 写入 CLAUDE.md 或 AGENTS.md
      hook: true                # → 生成 hook 脚本
      hook_type: "post_edit"
      hook_mode: "block"        # block | warn | off
      hook_check: "grep -E 'SELECT|INSERT|UPDATE|DELETE' {file}"

  - id: "typed-returns"
    rule: "Service 函数必须有返回类型注解"
    severity: important
    scope: "directory:lib/services/"
    source: auto
    enforcement:
      soft: true
      hook: false               # 需要语义理解，不适合 hook

  - id: "test-coverage"
    rule: "新文件必须有对应测试"
    severity: important
    scope: global
    source: auto
    enforcement:
      soft: true
      hook: true
      hook_type: "pre_complete"
      hook_mode: "block"

pipeline:
  planning: "ralplan"
  execution: "solo"
  verification:
    engine: "ralph"
    max_iterations: 50
  qa: true
  pre_commit:
    - "pnpm lint"
    - "pnpm typecheck"
  post_develop:
    - "pnpm test"

profiles:
  strict:
    constraints: all
    hooks: all
    pipeline: [planning, execution, review, qa]
  default:
    constraints: all
    hooks: [critical, important]
    pipeline: [planning, execution, review, qa]
  relaxed:
    constraints: [critical]
    hooks: [critical]
    pipeline: [execution]
  ci:
    constraints: all
    hooks: all
    pipeline: [execution, qa]
    output_format: json
```

---

## 约束生成流程

```
CodebaseContext
    │
    ▼
┌──────────────────┐
│ generateConstraints() │
│   技术栈模板 + 扫描推断 │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ classifyConstraints() │
│   按 severity 分级    │
│   critical → L0      │
│   important → L1     │
│   helpful → L2       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐      ┌────────────────┐
│ mergeConstraints()│ ←── │ 已有 constraints │ (Re-init 场景)
│   合并策略        │      └────────────────┘
└────────┬─────────┘
         │
         ▼
   constraints.yaml
```

---

## 约束来源：模板 + 推断

### 技术栈模板

每种技术栈有预置的通用约束模板：

```yaml
# templates/typescript.yaml
constraints:
  - id: "ts-strict"
    rule: "使用 TypeScript strict mode"
    severity: important
    condition: "tsconfig.strict !== true"  # 如果项目没开 strict 才加
  - id: "ts-no-any"
    rule: "避免使用 any 类型"
    severity: important
  - id: "ts-return-types"
    rule: "导出函数必须有返回类型注解"
    severity: helpful
```

```yaml
# templates/python.yaml
constraints:
  - id: "py-type-hints"
    rule: "函数参数和返回值使用 type hints"
    severity: important
  - id: "py-no-bare-except"
    rule: "不使用 bare except，指定具体异常类型"
    severity: critical
```

支持的模板：`typescript.yaml`, `python.yaml`, `go.yaml`, `rust.yaml`, `java.yaml`

### 项目推断

从 Scanner 的 CodebaseContext 中推断项目特有的约束：

```typescript
function inferConstraints(context: CodebaseContext): Constraint[] {
  const constraints: Constraint[] = [];

  // 从架构模式推断
  if (context.architecture.layers.includes('repository')) {
    constraints.push({
      id: 'use-repository-layer',
      rule: '数据库操作通过 repository 层，不在 service/controller 中直接访问',
      severity: 'critical',
    });
  }

  // 从已有规则推断
  if (context.existingRules.linter?.rules?.['no-console']) {
    constraints.push({
      id: 'no-console-log',
      rule: '不使用 console.log，使用项目的 logger',
      severity: 'important',
    });
  }

  // 从测试模式推断
  if (context.testing.pattern === '__tests__/') {
    constraints.push({
      id: 'test-location',
      rule: '测试文件放在 __tests__/ 目录',
      severity: 'helpful',
    });
  }

  return constraints;
}
```

### 最终合并

```
通用模板（per tech stack）     项目特异（per repo）
    ↓                              ↓
"TypeScript 项目通用规则"      "这个项目的特殊约定"
    ↓                              ↓
    └──────── 合并 ────────────────┘
                 ↓
          constraints.yaml
```

---

## 约束分级

```typescript
// constraints/classifier.ts

type Severity = 'critical' | 'important' | 'helpful';

interface ClassificationRule {
  pattern: RegExp | string;
  severity: Severity;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // Critical: 违反会导致严重问题
  { pattern: /数据库|SQL|安全|密钥|secret|env/i, severity: 'critical' },
  { pattern: /build.*fail|break|crash/i, severity: 'critical' },

  // Important: 影响架构一致性
  { pattern: /架构|分层|service|repository|测试/i, severity: 'important' },
  { pattern: /命名|约定|格式/i, severity: 'important' },

  // Helpful: 编码偏好
  { pattern: /模板|示例|参考|prefer/i, severity: 'helpful' },
];

function classifyConstraint(constraint: Constraint): Severity {
  // 优先使用 enforcement.hook 判断：有 hook 的至少是 important
  if (constraint.enforcement.hook) return 'critical';
  // 再用规则匹配
  for (const rule of CLASSIFICATION_RULES) {
    if (constraint.rule.match(rule.pattern)) return rule.severity;
  }
  return 'helpful';
}
```

**分级到上下文层的映射**：
- `critical` → L0 (CLAUDE.md, 始终可见)
- `important` → L1 (AGENTS.md, 进入目录时可见)
- `helpful` → L2 (.reins/patterns/, 按需检索)

---

## 合并策略（Re-init 场景）

```typescript
// constraints/merger.ts

interface MergeResult {
  kept: Constraint[];       // 用户确认过的，保留
  added: Constraint[];      // 新检测到的，标记为 draft
  deprecated: Constraint[]; // 不再适用的，标记废弃
  conflicts: ConflictPair[];// 需要用户决定
}

function mergeConstraints(
  prev: Constraint[],
  curr: Constraint[]
): MergeResult {
  const result: MergeResult = { kept: [], added: [], deprecated: [], conflicts: [] };

  for (const c of prev) {
    if (c.source === 'manual') {
      result.kept.push(c);  // 用户手动添加的，始终保留
    } else if (curr.some(n => n.id === c.id)) {
      const updated = curr.find(n => n.id === c.id)!;
      if (updated.rule !== c.rule) {
        result.conflicts.push({ old: c, new: updated });
      } else {
        result.kept.push(c);
      }
    } else {
      result.deprecated.push(c);  // 新扫描中不存在了
    }
  }

  for (const c of curr) {
    if (!prev.some(p => p.id === c.id)) {
      result.added.push({ ...c, source: 'auto', status: 'draft' });
    }
  }

  return result;
}
```

---

## Adapter 层（多格式输出）

```typescript
// adapters/base-adapter.ts
interface Adapter {
  name: string;
  outputPath: string;
  generate(constraints: Constraint[], context: CodebaseContext): string;
}
```

| Adapter | 输出文件 | 消费者 |
|---------|---------|--------|
| `claude-md.ts` | `CLAUDE.md` | Claude Code |
| `agents-md.ts` | 各目录 `AGENTS.md` | Claude Code / Codex |
| `cursor-rules.ts` | `.cursorrules` | Cursor |
| `copilot-instructions.ts` | `.github/copilot-instructions.md` | GitHub Copilot |
| `windsurf-rules.ts` | `.windsurfrules` | Windsurf |

**关键设计**：constraints.yaml 是规范中间格式，adapter 负责转换。第二个 AI 工具的适配只需新增一个 adapter。

---

## Profile 机制

不同任务需要不同严格程度的约束集：

```yaml
profiles:
  strict:
    constraints: all            # 全部约束
    hooks: all                  # 全部 hook
    pipeline: [planning, execution, review, qa]
  default:
    constraints: all
    hooks: [critical, important]
    pipeline: [planning, execution, review, qa]
  relaxed:
    constraints: [critical]     # 仅 critical
    hooks: [critical]           # 仅 critical
    pipeline: [execution]       # 跳过 planning 和 QA
```

使用：
```bash
reins develop "生产功能"                     # 使用默认 profile
reins develop --profile strict "安全相关"    # 全部约束
reins develop --profile relaxed "快速原型"   # 仅 critical 约束
```

---

## 子模块 & 源码结构

```
src/constraints/
├── generator.ts              # 约束生成（模板 + 推断）
├── classifier.ts             # 约束分级 (critical/important/helpful)
├── merger.ts                 # 合并策略 (merge/force/diff)
├── conflict-detector.ts      # 约束冲突检测
├── profiles.ts               # Profile 生成
├── schema.ts                 # constraints.yaml 类型定义
└── templates/
    ├── typescript.yaml
    ├── python.yaml
    ├── go.yaml
    ├── rust.yaml
    └── java.yaml

src/adapters/
├── base-adapter.ts
├── claude-md.ts
├── agents-md.ts
├── cursor-rules.ts
├── copilot-instructions.ts
└── windsurf-rules.ts
```

---

## 依赖关系

- **被依赖**：④ Context Generator、⑤ Hook System、⑥ Pipeline Runner、⑧ Self-Improving
- **依赖**：② Scanner（CodebaseContext）
- **外部依赖**：yaml (格式解析), handlebars/mustache (模板渲染, 可选)

---

## 实施优先级

- **MVP**：generator + classifier + claude-md adapter + agents-md adapter
- **Phase 2**：merger + profiles + cursor-rules/copilot/windsurf adapter
- **Phase 3**：conflict-detector + 更多模板
