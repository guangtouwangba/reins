# 架构设计（v2 — 整合架构师 Review）

## 工具形态决策

**推荐形态：npm CLI 工具 + optional OMC plugin adapter**

| 形态 | 优势 | 劣势 | 评分 |
|------|------|------|------|
| npm 包 / CLI | 跨编辑器、可独立运行、CI/CD 友好 | 需要自己实现 agent 调度 | 9/10 |
| Claude Code Plugin | 直接利用 Claude Code agent 基础设施 | 绑定 Claude Code | 8/10 |
| Claude Code Skill | 最快实现、复用 OMC 基础设施 | 仅 Claude Code + OMC | 7/10 |
| Python 包 | 生态丰富（AST 分析等） | 与 JS 生态断裂 | 5/10 |
| Shell 脚本集 | 简单、可移植 | 能力有限 | 3/10 |

**最佳路径**：CLI tool 作为最终形态，先用 Skill 快速验证核心逻辑。

## 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    dev-harness CLI                       │
│                                                          │
│  npx @dev-harness/cli init    ← MVP (无需 AI API key)    │
│  npx @dev-harness/cli develop ← Phase 2 (需要 AI)       │
│  npx @dev-harness/cli update  ← 增量更新                 │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │  Scanner   │→│  Analyzer  │→│  Generator  │         │
│  │ (L0-L2)   │  │ (patterns) │  │ (adapters) │         │
│  │ 确定性扫描  │  │ 启发式+AI  │  │ 多格式输出  │         │
│  └────────────┘  └────────────┘  └────────────┘         │
│       │                │               │                 │
│       ▼                ▼               ▼                 │
│  .dev-harness/     .dev-harness/   生成的文件:            │
│  manifest.json     constraints.yaml                      │
│  patterns.json     ├→ CLAUDE.md                          │
│                    ├→ AGENTS.md (per directory)           │
│                    ├→ .cursorrules                        │
│                    ├→ .github/copilot-instructions.md     │
│                    └→ .windsurfrules                      │
│                                                          │
│  Phase 2: Pipeline Runner                                │
│  ┌──────────────────────────────────────────┐            │
│  │ HARNESS_INIT → PLAN → EXEC → REVIEW → QA │            │
│  │ (约束注入)   (ralplan) (code) (ralph) (test)│           │
│  └──────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

## 模块 1：Codebase Scanner（探索器）

### 7 个探索维度

```typescript
interface CodebaseContext {
  // 1. 技术栈识别
  stack: {
    language: string[];          // 文件扩展名 + package.json/go.mod/Cargo.toml
    framework: string[];         // 依赖声明
    buildTool: string;           // webpack/vite/esbuild/make/gradle...
    testFramework: string;       // jest/pytest/go test/cargo test
    packageManager: string;      // npm/pnpm/yarn/pip/cargo
  };

  // 2. 架构模式
  architecture: {
    pattern: string;             // monolith/microservice/monorepo/library
    layers: string[];            // 从目录结构推断 (api/service/repo/model)
    entryPoints: string[];       // main files, route files
  };

  // 3. 代码约定
  conventions: {
    naming: string;              // camelCase/snake_case/PascalCase
    fileStructure: string;       // flat/nested/feature-based/layer-based
    importStyle: string;         // relative/absolute/alias
    configFormat: string;        // env/yaml/json/toml
  };

  // 4. 已有约束
  existingRules: {
    linter: object | null;       // .eslintrc / pylint / clippy config
    formatter: object | null;    // prettier / black / rustfmt config
    typeCheck: boolean;          // tsconfig strict mode etc.
    cicd: object | null;         // .github/workflows, Jenkinsfile
  };

  // 5. 测试模式
  testing: {
    framework: string;
    pattern: string;             // __tests__/foo.test.ts vs test/foo_test.go
    coverage: number | null;     // CI config 或 coverage reports
    fixtures: string[];          // 测试 fixture/mock 位置
  };

  // 6. 目录结构摘要
  structure: DirectoryManifest;  // 复用 OMC deepinit-manifest 格式

  // 7. 关键文件
  keyFiles: {
    readme: string | null;
    contributing: string | null;
    changelog: string | null;
    lockfile: string | null;
  };
}
```

### 探索策略（按成本从低到高）

| 层级 | 方法 | 成本 | 信息量 | MVP 需要 |
|------|------|------|-------|---------|
| L0 | 文件名/扩展名扫描 | 极低 | 技术栈、测试框架 | Yes |
| L1 | 配置文件解析 | 低 | 依赖、lint规则、CI | Yes |
| L2 | 目录结构分析 | 低 | 架构模式、约定 | Yes |
| L3 | 采样文件 AST 分析 | 中 | 编码约定、模式 | No |
| L4 | Git 历史分析 | 中 | 活跃区域、贡献者 | No |
| L5 | LLM 代码理解 | 高 | 业务逻辑、设计意图 | No |

**MVP 只需 L0-L2**，已经足够生成有用的约束文件。

## 模块 2：Harness Config Generator（约束生成器）

### 产出物目录结构

```
.dev-harness/
├── manifest.json         # 探索器输出的目录结构快照（机器可读）
├── patterns.json         # 检测到的约定和模式
├── constraints.yaml      # 约束配置的规范中间表示
└── generated/
    ├── CLAUDE.md         # Claude Code 约束文件
    ├── AGENTS.md         # 跨工具通用约束
    ├── .cursorrules      # Cursor 规则
    ├── .github/copilot-instructions.md
    └── .windsurfrules    # Windsurf 规则
```

### constraints.yaml 格式

```yaml
# .dev-harness/constraints.yaml — 约束配置的核心格式
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
  code:
    - "使用 TypeScript strict mode"
    - "所有函数必须有返回类型注解"
    - "错误处理使用 Result pattern，不用 try-catch"
    - "数据库操作必须通过 repository 层"

  architecture:
    - "所有 API endpoint 在 app/api/ 目录下"
    - "业务逻辑在 lib/services/ 中"
    - "数据访问在 lib/repositories/ 中"
    - "不允许在 component 中直接调用数据库"

  testing:
    - "每个 service 必须有对应的测试文件"
    - "测试文件放在 __tests__/ 目录"
    - "使用 fixtures/ 中的测试数据"
    min_coverage: 80

  review:
    - "检查是否引入新的依赖"
    - "检查是否有 N+1 查询"
    - "检查是否有 XSS/SQL 注入风险"

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
```

## 模块 3：Pipeline Runner（流水线运行器）

```
HARNESS_INIT → RALPLAN → EXECUTION → RALPH → QA
     ↑                                        │
     └────────────── feedback loop ────────────┘
```

**HARNESS_INIT 阶段**：将 constraints.yaml 的约束注入到后续所有阶段的 prompt 中。

## 关键设计决策

### 决策 1：约束文件 vs 可执行约束

| 方案 | 静态文件 (CLAUDE.md) | 可执行规则 (hooks) |
|------|---------------------|-------------------|
| 优势 | 简单、可审查、版本控制 | 强制执行、自动验证 |
| 劣势 | LLM 可能忽略 | 复杂、需要 runtime |
| **建议** | **主要方案** | **辅助验证** |

**结论**：约束以 markdown 为主，辅以 hooks 做关键检查。LLM 理解 markdown 的能力远强于解析配置文件。

### 决策 2：通用模板 vs 项目特异

```
通用模板（per tech stack）     项目特异（per repo）
    ↓                              ↓
"TypeScript 项目通用规则"      "这个项目的特殊约定"
    ↓                              ↓
    └──────── 合并 ────────────────┘
                 ↓
          最终 CLAUDE.md
```

### 决策 3：与现有工具的关系

```
dev-harness init  →  生成 CLAUDE.md / AGENTS.md / .cursorrules
                          ↓
                  被以下工具消费：
                  - Claude Code（读取 CLAUDE.md）
                  - Cursor（读取 .cursorrules）
                  - Codex（读取 AGENTS.md）
                  - GitHub Copilot（读取 .github/copilot-instructions.md）
                  - OMC autopilot（读取 CLAUDE.md + constraints.yaml 驱动流水线）
```

**Harness 是"约束生成器"，不是"约束消费者"。**

### 决策 4：架构权衡

| 决策 | 选项 A | 选项 B | 推荐 |
|------|--------|--------|------|
| **AI 依赖** | 全阶段必须（更丰富） | AI 可选（更广采用） | **AI 可选 for scan/constrain** |
| **约束格式** | 直接生成目标格式 | 规范中间格式 + adapters | **中间格式**，第二个工具时回本 |
| **范围** | 仅 meta-tool | meta-tool + 自主 agent | **meta-tool 优先**，v2 加自主模式 |
| **状态存储** | 仓库内 (.dev-harness/) | 外部 (~/.dev-harness/) | **仓库内 + .gitignore** |
| **扫描模式** | 始终全量 | 增量 + manifest diffing | **增量**，全量作为 --force |
| **更新触发** | 仅手动 | 事件驱动 | **事件驱动** + 手动覆盖 |
| **约束保护** | agent 可修改 | agent 只读 | **PreToolUse hook 保护 constraints.yaml** |

---

## [v2 新增] 元配置：reins.config.yaml

Reins 自身的行为也需要可配置，而不是硬编码。

```yaml
# .reins/config.yaml — 控制 Reins 自身行为（可选文件，全部有默认值）
scan:
  depth: "L0-L2"              # L0 | L0-L1 | L0-L2 | L0-L5
  exclude_dirs: ["vendor/", "generated/"]

develop:
  default_model: "sonnet"      # haiku | sonnet | opus
  skip_stages: []              # ["planning", "qa"]
  constraint_profile: "default" # strict | default | relaxed | custom

learn:
  auto_extract_threshold: 85   # >= 此分自动保存为 draft skill
  suggestion_threshold: 60     # >= 此分提示用户
  cooldown_messages: 5         # 每 N 条消息最多提示一次
  scope_default: "project"     # project | global

update:
  auto_trigger: "session_end"  # manual | session_end | file_count:50 | interval:1d
  staleness_check: true        # 检测引用了不存在的文件/目录的约束
  auto_apply: false            # true = 高置信度变更自动应用

hooks:
  default_mode: "block"        # block | warn | off
  health_check: true           # 自动禁用连续失败的 hook
  health_threshold: 5          # 连续 N 次意外错误后禁用

status:
  default_format: "human"      # human | json | markdown
  history_days: 30
```

所有字段可选，均有合理默认值。文件不存在时使用全部默认值。

---

## [v2 新增] 约束 Profile 机制

不同任务需要不同严格程度的约束集：

```yaml
# constraints.yaml 中的 profiles 部分
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

使用方式：
```
/reins develop "生产功能"                     # 使用默认 profile
/reins develop --profile strict "安全相关"    # 全部约束 + 全部 hook
/reins develop --profile relaxed "快速原型"   # 仅 critical 约束
/reins develop --skip qa "修 README 错别字"   # 跳过 QA 阶段
```

---

## [v2 新增] Re-init 合并策略

在已有 `.reins/` 的项目上重新运行 init：

```
/reins init              # 默认 --merge：保留用户修改，添加新检测，标记冲突
/reins init --force      # 全部重新生成（覆盖所有）
/reins init --diff       # 仅预览差异，不写入任何文件
```

**合并逻辑**：
- 用户手动修改过的约束 → 保留
- 新检测到的约束 → 添加为 draft
- 不再适用的约束 → 标记为 deprecated，不直接删除
- 冲突 → 交互式让用户选择

---

## [v2 新增] 多用户协作模型

```
.reins/ 文件分类：

  团队共享（提交到 git）：
    ├── constraints.yaml       # 约束定义
    ├── config.yaml            # 团队级 Reins 配置
    ├── hooks/                 # Hook 脚本
    ├── patterns/              # L2 模式参考
    └── README.md              # 使用说明

  个人专属（.gitignore）：
    ├── config.local.yaml      # 个人偏好覆盖
    ├── manifest.json          # 本地目录快照
    ├── logs/                  # 执行日志
    ├── skills/auto/           # 自动学习的 skill
    └── context.json           # 本地探索缓存
```

`config.local.yaml` 覆盖 `config.yaml` 中的同名字段，不提交到 git。

---

## [v2 新增] 约束保护机制

防止 AI agent 意外修改约束文件：

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": ".reins/hooks/protect-constraints.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
#!/bin/bash
# .reins/hooks/protect-constraints.sh
FILE=$(jq -r '.tool_input.file_path // .tool_input.filePath // empty')
[ -z "$FILE" ] && exit 0

# 保护 constraints.yaml 不被 agent 修改
if echo "$FILE" | grep -qE '\.reins/constraints\.yaml|\.reins/config\.yaml|\.reins/hooks/'; then
  echo "⛔ Reins: 约束文件受保护，不允许 agent 直接修改。" >&2
  echo "   请使用 /reins update 或 /reins hook 命令管理约束。" >&2
  exit 2
fi

exit 0
```
