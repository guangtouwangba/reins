# Reins

**AI 编码代理约束治理工具** — 扫描项目、生成约束、强制执行、知识沉淀、持续进化。

---

## 核心问题

Claude Code、Cursor、Copilot 等 AI 编码代理共同面临一个问题：它们不了解你的项目。

它们不知道：
- 这个项目用 Prisma，不用原生 SQL
- `payment` 模块改动需要同步更新 webhook handler
- 错误处理统一用 `Result` 类型，不用 try-catch
- Edge Runtime 不能用标准 Prisma client

每次新 session 开始，agent 都从零出发。每次都在重复犯同样的错误。

Reins 解决这个问题。它扫描你的项目，提取约束，生成多格式上下文文件，并通过 Hook 强制执行——同时在每次任务结束后捕获新的项目知识，让约束随项目一起进化。

---

## 工作原理

```
扫描项目
   ↓
生成 constraints.yaml（项目约束定义）
   ↓
多格式输出：CLAUDE.md / AGENTS.md / .cursorrules / copilot-instructions.md
   ↓
Hook 强制执行（PreToolUse / PostToolUse / Stop）
   ↓
任务结束后知识沉淀（捕获耦合、踩坑、决策、偏好）
   ↓
高置信度知识毕业为正式约束 → 反馈到 constraints.yaml
```

---

## 快速开始

```bash
# 初始化项目约束
npx reins init

# 预览将生成的文件，不实际写入
npx reins init --dry-run

# 仅生成 L0 层（顶层 CLAUDE.md）
npx reins init --depth L0
```

`reins init` 执行后，项目根目录生成：

```
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

## 核心特性

### ① CLI + State — 入口与状态管理

统一命令入口，管理约束生命周期（init → develop → update → rollback）。状态快照支持任意时间点回滚。

### ② Scanner — 代码库探索器

分析目录结构、依赖、框架特征，生成 `context.json` 和 `manifest.json`，作为后续约束生成的输入。

### ③ Constraint Generator — 约束生成器

消费 Scanner 输出，推断项目约束，写入 `constraints.yaml`。支持多个约束 Profile（如 `strict` / `default` / `review`）。

### ④ Progressive Context Generator — 渐进式上下文生成器

将 `constraints.yaml` 渲染为多格式上下文文件。三层模型（L0/L1/L2）控制信息密度，避免 context 浪费。

### ⑤ Hook System — Hook 系统

生成 Claude Code Hook 脚本（`UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop`），在 agent 操作前后强制验证约束。

### ⑥ Pipeline Runner — 流水线运行器

`reins develop <task>` 驱动完整开发流水线：约束注入 → 代码生成 → 验证 → 评估，确保每个阶段都在约束下运行。

### ⑦ Evaluation System — 评估系统

消费 `verification.yaml`，驱动多层验证（lint、test、类型检查、自定义脚本），收集执行结果用于自进化分析。

### ⑧ Self-Improving — 自进化闭环

分析执行日志，识别高频错误模式和可优化的约束，自动或建议更新 `constraints.yaml`。

### ⑨ Knowledge System — 隐式知识系统

捕获 agent 的"经历"并转化为"经验"。任务完成后触发结构化反思，将耦合关系、踩坑记录、架构决策、用户偏好存入 `.reins/knowledge/`，在下次相关任务时自动注入。高置信度知识可毕业为正式约束。

---

## 命令列表

| 命令 | 说明 |
|------|------|
| `reins init` | 扫描项目，生成约束和上下文文件 |
| `reins develop <task>` | 在约束下自动执行开发任务 |
| `reins status` | 查看约束状态和统计信息 |
| `reins update` | 增量更新约束（基于最新代码扫描） |
| `reins test` | 测试约束和 Hook 是否正常运行 |
| `reins rollback` | 回滚到指定快照 |
| `reins learn` | 保存本次 session 学到的知识 |
| `reins analyze` | 分析执行历史，输出改进建议 |
| `reins hook` | 管理 Hook（add / list / disable / fix / promote） |

```bash
# 常用选项示例
reins init --dry-run              # 预览，不写文件
reins init --depth L0             # 只生成顶层 CLAUDE.md
reins init --force                # 覆盖已有 .reins/ 配置
reins develop "add user login"    # 约束下执行开发任务
reins status --format json        # JSON 格式输出状态
reins update --auto-apply         # 自动应用高置信度更新
reins rollback --to <snapshot>    # 回滚到指定快照
reins learn --auto                # 全自动 OBSERVE → ANALYZE → LEARN 流水线
```

---

## 渐进式上下文设计（L0 / L1 / L2）

这是 Reins 的核心设计之一。AI agent 的 context window 是稀缺资源，不应该把所有约束一次性塞入。

```
L0  CLAUDE.md（项目根）
    始终加载。内容：项目地图、关键命令、3-5 条最重要的全局约束。
    目标：让 agent 在任何任务开始前都有基本方向感。
    大小控制：< 50 行。

L1  AGENTS.md（各目录）
    进入目录时自动加载。内容：该目录的约束、模式、禁忌。
    目标：让 agent 在进入具体模块时获得精准上下文。
    大小控制：< 30 行/目录。

L2  .reins/patterns/（详细参考）
    按需读取。内容：完整的模式示例、代码模板、详细规范。
    目标：agent 需要深入了解时自行查阅，不占用默认 context。
    大小控制：不限制，但按文件分离。
```

三层结构确保：agent 始终有足够上下文，但不会被无关信息淹没。

---

## 知识系统（隐式知识捕获与沉淀）

这是 Reins 的另一个核心创新。传统约束是静态的；Reins 的知识系统让约束随项目演进而成长。

### 四种知识类型

| 类型 | 示例 | 来源 |
|------|------|------|
| `coupling`（耦合） | "auth 和 webhook 共享 session store" | 任务完成反思 |
| `gotcha`（踩坑） | "Prisma 在 Edge Runtime 不能用" | 失败重试 |
| `decision`（决策） | "选 Redis 因为需要 pub/sub" | 任务完成反思 |
| `preference`（偏好） | "用户偏好函数式，避免 class" | 用户纠正 |

### 三个捕获触发点

- **任务完成后**：Stop hook 通过后触发结构化反思，agent 总结本次任务中发现的耦合、踩坑、决策
- **用户纠正时**：检测到否定信号（"不对"、"换个方式"）时，提取"期望差"背后的原则
- **失败重试后**：hook 拦截或测试失败导致 agent 改变方法时，提取负面知识（"不要在这里这样做"）

### 检索与注入

知识通过 `UserPromptSubmit` hook 自动注入，采用**文件亲和度（File-Affinity）**检索：根据任务涉及的文件路径匹配相关知识，注入格式为摘要 + 路径（不超过 200 tokens），agent 需要详情时自行读取知识文件。

### 知识毕业

```
隐式知识（confidence 50-70）
    ↓ 多次注入验证
验证中知识（confidence 70-90）
    ↓ confidence > 90，注入次数 > 5，成功率 > 80%
候选约束（提示用户确认）
    ↓
正式约束（写入 constraints.yaml）
```

---

## 项目结构

```
reins/
├── src/
│   ├── cli.ts              # CLI 入口（commander）
│   ├── commands/           # 各命令实现（init / status / update / rollback 等）
│   ├── scanner/            # 代码库探索器
│   ├── constraints/        # 约束生成器
│   ├── context/            # 渐进式上下文生成器
│   ├── hooks/              # Hook 系统
│   ├── pipeline/           # 流水线运行器
│   ├── evaluation/         # 评估系统
│   ├── learn/              # 自进化（analyzer + learner）
│   ├── knowledge/          # 隐式知识系统
│   ├── adapters/           # 多格式输出（CLAUDE.md / .cursorrules 等）
│   └── state/              # 状态管理
├── templates/              # 模板文件
└── test/                   # 测试
```

---

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（直接运行 TypeScript）
pnpm dev -- init --dry-run

# 运行测试
pnpm test

# 类型检查
pnpm typecheck
```

**依赖**：Node.js >= 18，pnpm

---

## 设计文档

详细的模块设计文档在 `modules/` 目录：

| 文档 | 内容 |
|------|------|
| [modules/00-overview.md](modules/00-overview.md) | 系统全景、模块依赖、数据流、实施节奏 |
| [modules/01-cli-state.md](modules/01-cli-state.md) | CLI 入口 + 状态管理 |
| [modules/02-scanner.md](modules/02-scanner.md) | 代码库探索器 |
| [modules/03-constraint-generator.md](modules/03-constraint-generator.md) | 约束生成器 |
| [modules/04-context-generator.md](modules/04-context-generator.md) | 渐进式上下文生成器（L0/L1/L2） |
| [modules/05-hook-system.md](modules/05-hook-system.md) | Hook 系统 |
| [modules/06-pipeline-runner.md](modules/06-pipeline-runner.md) | 流水线运行器 |
| [modules/07-evaluation.md](modules/07-evaluation.md) | 评估系统 |
| [modules/08-self-improving.md](modules/08-self-improving.md) | 自进化闭环 |
| [modules/09-knowledge-system.md](modules/09-knowledge-system.md) | 隐式知识系统（捕获、检索、毕业） |

---

## License

MIT
