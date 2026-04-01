# Reins

AI 编码代理约束治理工具。Reins 会扫描你的项目、生成约束、通过 Hook 强制执行、沉淀知识，并持续演化。

English version: [README.md](README.md)

---

## 问题背景

Claude Code、Cursor、Copilot 这类 AI 编码代理有一个共同问题：它们不了解你的项目。

它们不知道：
- 这个项目使用的是 Prisma，而不是原始 SQL
- 改动 `payment` 时需要同步 webhook handler
- 错误处理用的是 `Result` 类型，而不是 `try/catch`
- Edge Runtime 不能使用标准 Prisma client

于是每个新 session 都像从零开始，同样的错误会一再重复。

**Reins 就是为了解决这个问题。** 它扫描项目、提取约束、生成多格式上下文文件、通过 Hook 强制执行，并在每次任务后捕获新知识，让约束随着项目一起演进。

---

## 工作方式

```text
扫描项目
   ↓
生成 constraints.yaml（项目约束定义）
   ↓
多格式输出：CLAUDE.md / AGENTS.md / .cursorrules / copilot-instructions.md
   ↓
Hook 强制执行（PreToolUse / PostToolUse / Stop）
   ↓
任务后知识捕获（耦合、坑点、决策、偏好）
   ↓
高置信度知识毕业为正式约束 → 回流到 constraints.yaml
```

---

## 快速开始

```bash
# 初始化项目约束
npx reins init

# 预览，不写文件
npx reins init --dry-run

# 仅生成 L0（顶层 CLAUDE.md）
npx reins init --depth L0
```

执行 `reins init` 后，项目中会生成：

```text
your-project/
├── CLAUDE.md                        # L0：全局地图 + 核心约束
├── app/
│   └── AGENTS.md                    # L1：目录级约束
├── lib/
│   └── AGENTS.md                    # L1：目录级约束
├── .cursorrules                     # Cursor 格式
├── .github/copilot-instructions.md  # GitHub Copilot 格式
├── .windsurfrules                   # Windsurf 格式
├── .claude/
│   └── settings.json                # Hook 配置
└── .reins/
    ├── constraints.yaml             # 约束定义（团队共享）
    ├── config.yaml                  # Reins 元配置
    ├── verification.yaml            # 验证配方
    ├── hooks/                       # Hook 脚本
    ├── patterns/                    # L2 模式参考文件
    └── knowledge/                   # 隐式知识库
```

---

## 核心能力

### 1. CLI + State

统一命令入口管理约束生命周期（`init → develop → update → rollback`）。基于快照的状态管理支持回滚到任意时间点。

### 2. Scanner

分析目录结构、依赖和框架特征。输出 `context.json` 和 `manifest.json`，作为约束生成的输入。支持六种扫描深度（`L0-L5`）。

### 3. Constraint Generator

消费扫描结果，推断项目约束并写入 `constraints.yaml`。支持多种 profile（`strict`、`default`、`relaxed`、`ci`）和技术栈模板（TypeScript、Python、Go、Rust、Java）。

### 4. Progressive Context Generator

把 `constraints.yaml` 渲染成多格式上下文文件。三层模型（`L0/L1/L2`）控制信息密度，让 agent 在需要时拿到恰当的信息，而不是一次性灌入所有内容。

### 5. Hook System

生成 Claude Code Hook 脚本（`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`）。在 agent 操作前后确定性执行约束。支持三种模式：`block`、`warn`、`off`。

### 6. Pipeline Runner

`reins develop <task>` 的设计目标是驱动完整开发流水线：约束注入、规划、执行、评审、QA。每个阶段都在约束之下运行。

### 7. Evaluation System

五层验证体系：`L0`（静态检查）→ `L1`（覆盖率门禁）→ `L2`（集成验证）→ `L3`（E2E）→ `L4`（语义评审）。退出条件由 profile 控制。

### 8. Self-Improving Loop

`OBSERVE → ANALYZE → LEARN → CONSTRAIN` 闭环。分析执行日志，识别重复错误模式，自动应用高置信度改进，并给出中等置信度建议。

### 9. Knowledge System

把 agent 的“经历”转化为“经验”。任务完成后的结构化反思会把耦合关系、坑点、决策和偏好写入 `.reins/knowledge/`。相关知识会在后续任务中自动注入。高置信度知识最终会毕业为正式约束。

---

## 命令列表

| 命令 | 说明 |
|------|------|
| `reins init` | 扫描项目，生成约束和上下文文件 |
| `reins develop <task>` | 在约束下自动开发 |
| `reins status` | 查看约束状态和统计信息 |
| `reins update` | 基于最新扫描结果增量更新约束 |
| `reins test` | 测试约束和 Hook |
| `reins rollback` | 回滚到指定快照 |
| `reins learn` | 保存当前 session 学到的知识 |
| `reins analyze` | 分析执行历史并给出改进建议 |
| `reins hook` | 管理 hooks |

```bash
reins init --dry-run              # 预览，不写文件
reins init --depth L0             # 只生成顶层 CLAUDE.md
reins init --force                # 覆盖已有 .reins/ 配置
reins develop "add user login"    # 在约束下开发
reins status --format json        # JSON 输出
reins update --auto-apply         # 自动应用高置信度更新
reins rollback --to <snapshot>    # 回滚到指定快照
reins learn --auto                # 完整 OBSERVE → ANALYZE → LEARN 流程
```

---

## 渐进式上下文设计（`L0 / L1 / L2`）

Agent 的上下文窗口是稀缺资源，不应该一次性塞入全部约束。

```text
L0  CLAUDE.md（项目根目录）
    始终加载。包含项目地图、关键命令、3-5 条全局核心约束。
    目标：在任务开始前提供基础定位。
    预算：< 50 行，约 500-800 tokens。

L1  AGENTS.md（目录级）
    进入目录时自动加载。包含目录约束、模式和禁令。
    目标：为当前模块提供精确上下文。
    预算：每个目录 < 30 行，约 300-500 tokens。

L2  .reins/patterns/（细节参考）
    按需检索。包含完整示例、代码模板和详细说明。
    目标：在 agent 真正需要时提供深度参考，而不是预加载。
    预算：不限，按文件拆分。
```

这三层确保 agent 始终有足够上下文，但不会被无关信息淹没。

---

## Knowledge System

传统约束是静态的，而 Reins 的知识系统让约束随着项目成长。

### 四类知识

| 类型 | 示例 | 来源 |
|------|------|------|
| `coupling` | `auth and webhook share session store` | 任务后反思 |
| `gotcha` | `Prisma doesn't work in Edge Runtime` | 失败重试 |
| `decision` | `Chose Redis for pub/sub` | 任务后反思 |
| `preference` | `User prefers functional style, avoid classes` | 用户纠正 |

### 三个捕获时机

- 任务完成后：`Stop` Hook 触发结构化反思
- 用户纠正时：把期望差异提炼为原则
- 失败重试后：当失败后改变做法时，捕获负面知识

### 检索与注入

知识通过 `UserPromptSubmit` Hook 基于文件亲和性进行自动注入。注入内容是摘要加路径引用，agent 在需要时再读取完整知识文件。

### 知识毕业机制

```text
隐式知识（confidence 50-70）
    ↓ 多次注入验证
已验证知识（confidence 70-90）
    ↓ confidence > 90，注入次数 > 5，成功率 > 80%
候选约束（提示用户确认）
    ↓
正式约束（写入 constraints.yaml）
```

---

## 项目结构

```text
reins/
├── src/
│   ├── cli.ts              # CLI 入口（Commander.js）
│   ├── commands/           # 命令处理器（init / status / update / rollback ...）
│   ├── scanner/            # 代码库探索器（L0-L5）
│   ├── constraints/        # 约束生成器 + 分类器 + 模板
│   ├── context/            # 渐进式上下文生成器（L0/L1/L2）
│   ├── hooks/              # Hook 生成器 + settings writer + health monitor
│   ├── pipeline/           # Pipeline runner + constraint injector + QA
│   ├── evaluation/         # 五层验证（L0-L4）
│   ├── learn/              # 自进化（observer + analyzer + learner）
│   ├── knowledge/          # 知识系统（capture + retrieval + graduation）
│   ├── adapters/           # 多格式输出 adapters
│   └── state/              # Config + manifest + snapshot
├── modules/                # 设计文档
├── docs/                   # 补充文档
└── openspec/               # OpenSpec 变更档案
```

---

## 开发

```bash
pnpm install        # 安装依赖
pnpm build          # 构建（tsc strict mode）
pnpm dev -- init    # 开发模式（tsx，无需先 build）
pnpm test           # 运行测试（vitest）
pnpm typecheck      # 类型检查
```

**要求**：Node.js >= 18，pnpm

---

## 设计文档

更详细的模块设计说明位于 `modules/`：

| 文档 | 内容 |
|------|------|
| [00-overview.md](modules/00-overview.md) | 系统总览、模块依赖、数据流 |
| [01-cli-state.md](modules/01-cli-state.md) | CLI 入口 + 状态管理 |
| [02-scanner.md](modules/02-scanner.md) | 代码库探索器 |
| [03-constraint-generator.md](modules/03-constraint-generator.md) | 约束生成器 |
| [04-context-generator.md](modules/04-context-generator.md) | 渐进式上下文（`L0/L1/L2`） |
| [05-hook-system.md](modules/05-hook-system.md) | Hook 系统 |
| [06-pipeline-runner.md](modules/06-pipeline-runner.md) | Pipeline runner |
| [07-evaluation.md](modules/07-evaluation.md) | 评估系统 |
| [08-self-improving.md](modules/08-self-improving.md) | 自进化闭环 |
| [09-knowledge-system.md](modules/09-knowledge-system.md) | 知识系统（捕获、检索、毕业） |

补充运行时文稿：

- [docs/user-requirement-runtime-sequence.md](docs/user-requirement-runtime-sequence.md)：当前版本中“用户输入需求后系统如何运行”的真实时序说明

---

## 许可证

MIT
