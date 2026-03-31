# Reins

**Constraint governance for AI coding agents** — scan your project, generate constraints, enforce via hooks, capture knowledge, evolve continuously.

**AI 编码代理约束治理工具** — 扫描项目、生成约束、强制执行、知识沉淀、持续进化。

---

## The Problem

AI coding agents (Claude Code, Cursor, Copilot) share a fundamental gap: they don't know your project.

They don't know:
- This project uses Prisma, not raw SQL
- Changing `payment` requires syncing the webhook handler
- Error handling uses the `Result` type, not try-catch
- Edge Runtime can't use the standard Prisma client

Every new session starts from zero. The same mistakes repeat.

**Reins fixes this.** It scans your project, extracts constraints, generates multi-format context files, enforces them via hooks — and captures new knowledge after each task so constraints evolve with your project.

> AI 编码代理（Claude Code、Cursor、Copilot）的共同问题：不了解你的项目。每次新 session 从零开始，反复犯同样的错。Reins 扫描项目、提取约束、通过 Hook 强制执行，并在每次任务后捕获新知识，让约束随项目进化。

---

## How It Works

```
Scan project
   ↓
Generate constraints.yaml (project constraint definitions)
   ↓
Multi-format output: CLAUDE.md / AGENTS.md / .cursorrules / copilot-instructions.md
   ↓
Hook enforcement (PreToolUse / PostToolUse / Stop)
   ↓
Post-task knowledge capture (couplings, gotchas, decisions, preferences)
   ↓
High-confidence knowledge graduates to formal constraints → feedback to constraints.yaml
```

---

## Quick Start

```bash
# Initialize project constraints
# 初始化项目约束
npx reins init

# Preview without writing files
# 预览，不写文件
npx reins init --dry-run

# Generate only L0 (top-level CLAUDE.md)
# 仅生成顶层 CLAUDE.md
npx reins init --depth L0
```

After `reins init`, your project gets:

```
your-project/
├── CLAUDE.md                        # L0: global map + critical constraints
├── app/
│   └── AGENTS.md                    # L1: directory-level constraints
├── lib/
│   └── AGENTS.md                    # L1: directory-level constraints
├── .cursorrules                     # Cursor format
├── .github/copilot-instructions.md  # GitHub Copilot format
├── .windsurfrules                   # Windsurf format
├── .claude/
│   └── settings.json                # Hook configuration
└── .reins/
    ├── constraints.yaml             # Constraint definitions (team-shared)
    ├── config.yaml                  # Reins meta-configuration
    ├── verification.yaml            # Verification recipe
    ├── hooks/                       # Hook scripts
    ├── patterns/                    # L2 pattern reference files
    └── knowledge/                   # Implicit knowledge base
```

---

## Core Features

### ① CLI + State — Entry Point & State Management

Unified command entry, manages constraint lifecycle (init → develop → update → rollback). Snapshot-based state enables rollback to any point in time.

> 统一命令入口，管理约束生命周期。状态快照支持任意时间点回滚。

### ② Scanner — Codebase Explorer

Analyzes directory structure, dependencies, and framework characteristics. Outputs `context.json` and `manifest.json` as input for constraint generation. Supports 6 scan depths (L0-L5).

> 分析目录结构、依赖、框架特征，生成结构化上下文，支持 6 层扫描深度。

### ③ Constraint Generator

Consumes Scanner output, infers project constraints, writes `constraints.yaml`. Supports multiple profiles (`strict` / `default` / `relaxed` / `ci`) and tech stack templates (TypeScript, Python, Go, Rust, Java).

> 消费 Scanner 输出，推断约束，支持多 Profile 和技术栈模板。

### ④ Progressive Context Generator

Renders `constraints.yaml` into multi-format context files. The three-layer model (L0/L1/L2) controls information density — agents get exactly what they need, nothing more.

> 渐进式三层模型控制信息密度，避免 context 浪费。

### ⑤ Hook System

Generates Claude Code hook scripts (`UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop`). Enforces constraints deterministically before and after agent operations. Three modes: `block` / `warn` / `off`.

> 生成 Hook 脚本，在 agent 操作前后确定性地验证约束。三种模式：阻止/警告/关闭。

### ⑥ Pipeline Runner

`reins develop <task>` drives the full development pipeline: constraint injection → planning → execution → review → QA. Every stage runs under constraints.

> 驱动完整开发流水线，每个阶段都在约束下运行。

### ⑦ Evaluation System

5-layer verification: L0 (static checks) → L1 (coverage gate) → L2 (integration verify) → L3 (E2E) → L4 (semantic review). Profile-based exit conditions for the review loop.

> 五层验证体系，基于 Profile 的退出条件。

### ⑧ Self-Improving Loop

OBSERVE → ANALYZE → LEARN → CONSTRAIN closed loop. Analyzes execution logs, detects recurring error patterns, auto-applies high-confidence improvements (>85%), suggests medium-confidence ones (60-85%).

> 闭环自进化：分析执行日志，识别模式，自动或建议更新约束。

### ⑨ Knowledge System — Implicit Knowledge

Captures agent "experience" and converts it to "expertise". Structured reflection after task completion stores couplings, gotchas, decisions, and preferences into `.reins/knowledge/`. Auto-injected on the next relevant task. High-confidence knowledge graduates to formal constraints.

> 捕获 agent 的"经历"转化为"经验"。任务后结构化反思，下次相关任务自动注入。高置信度知识毕业为正式约束。

---

## Commands

| Command | Description |
|---------|-------------|
| `reins init` | Scan project, generate constraints and context files |
| `reins develop <task>` | Auto-develop under constraints |
| `reins status` | View constraint status and statistics |
| `reins update` | Incrementally update constraints from latest scan |
| `reins test` | Test constraints and hooks |
| `reins rollback` | Rollback to a specific snapshot |
| `reins learn` | Save knowledge learned from current session |
| `reins analyze` | Analyze execution history, output improvement suggestions |
| `reins hook` | Manage hooks (add / list / disable / fix / promote) |

```bash
reins init --dry-run              # Preview, no file writes
reins init --depth L0             # Only generate top-level CLAUDE.md
reins init --force                # Overwrite existing .reins/ config
reins develop "add user login"    # Develop under constraints
reins status --format json        # JSON output
reins update --auto-apply         # Auto-apply high-confidence updates
reins rollback --to <snapshot>    # Rollback to snapshot
reins learn --auto                # Full OBSERVE → ANALYZE → LEARN pipeline
```

---

## Progressive Context Design (L0 / L1 / L2)

An agent's context window is a scarce resource. Don't dump all constraints at once.

> AI agent 的 context window 是稀缺资源，不应把所有约束一次性塞入。

```
L0  CLAUDE.md (project root)
    Always loaded. Project map, key commands, 3-5 critical global constraints.
    Goal: basic orientation before any task.
    Budget: < 50 lines, ~500-800 tokens.

L1  AGENTS.md (per directory)
    Auto-loaded when entering a directory. Directory constraints, patterns, prohibitions.
    Goal: precise context for the current module.
    Budget: < 30 lines per directory, ~300-500 tokens.

L2  .reins/patterns/ (detail reference)
    On-demand retrieval. Full examples, code templates, detailed specs.
    Goal: deep reference when agent needs it, never preloaded.
    Budget: unlimited, file-separated.
```

Three layers ensure: agents always have enough context, but are never drowned in irrelevant information.

> 三层结构确保：agent 始终有足够上下文，但不会被无关信息淹没。

---

## Knowledge System

Traditional constraints are static. Reins' knowledge system lets constraints grow with your project.

> 传统约束是静态的，Reins 让约束随项目演进而成长。

### Four Knowledge Types

| Type | Example | Source |
|------|---------|--------|
| `coupling` | "auth and webhook share session store" | Post-task reflection |
| `gotcha` | "Prisma doesn't work in Edge Runtime" | Failure retry |
| `decision` | "Chose Redis for pub/sub" | Post-task reflection |
| `preference` | "User prefers functional style, avoid classes" | User correction |

### Three Capture Triggers

- **After task completion**: Stop hook triggers structured reflection — agent summarizes discovered couplings, gotchas, decisions
- **On user correction**: Detects negation signals ("no", "don't", "wrong") and extracts the principle behind the expectation gap
- **After failure retry**: When a hook blocks or test fails and agent changes approach, captures negative knowledge ("don't do this here")

> 三个捕获时机：任务完成后反思、用户纠正时提取原则、失败重试后捕获负面知识。

### Retrieval & Injection

Knowledge is auto-injected via `UserPromptSubmit` hook using **file-affinity** retrieval: matches knowledge entries against involved file paths. Injection format is summary + path reference (< 200 tokens). Agent reads full knowledge file when needed.

### Knowledge Graduation

```
Implicit knowledge (confidence 50-70)
    ↓ validated through multiple injections
Validated knowledge (confidence 70-90)
    ↓ confidence > 90, injections > 5, success rate > 80%
Candidate constraint (prompt user confirmation)
    ↓
Formal constraint (written to constraints.yaml)
```

---

## Project Structure

```
reins/
├── src/
│   ├── cli.ts              # CLI entry (Commander.js)
│   ├── commands/           # Command handlers (init / status / update / rollback ...)
│   ├── scanner/            # Codebase explorer (L0-L5)
│   ├── constraints/        # Constraint generator + classifier + templates
│   ├── context/            # Progressive context generator (L0/L1/L2)
│   ├── hooks/              # Hook generator + settings writer + health monitor
│   ├── pipeline/           # Pipeline runner + constraint injector + QA
│   ├── evaluation/         # 5-layer evaluation (L0-L4)
│   ├── learn/              # Self-improving (observer + analyzer + learner)
│   ├── knowledge/          # Knowledge system (capture + retrieval + graduation)
│   ├── adapters/           # Multi-format output (CLAUDE.md / .cursorrules ...)
│   └── state/              # Config + manifest + snapshot
├── modules/                # Design documents (10 module specs)
└── openspec/               # OpenSpec change archive (23 changes)
```

---

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build (tsc strict mode)
pnpm dev -- init    # Dev mode (tsx, no build needed)
pnpm test           # Run tests (315 tests, vitest)
pnpm typecheck      # Type check
```

**Requirements**: Node.js >= 18, pnpm

---

## Design Documents

Detailed module design specs in `modules/`:

| Document | Content |
|----------|---------|
| [00-overview.md](modules/00-overview.md) | System overview, module dependencies, data flow |
| [01-cli-state.md](modules/01-cli-state.md) | CLI entry + state management |
| [02-scanner.md](modules/02-scanner.md) | Codebase explorer |
| [03-constraint-generator.md](modules/03-constraint-generator.md) | Constraint generator |
| [04-context-generator.md](modules/04-context-generator.md) | Progressive context (L0/L1/L2) |
| [05-hook-system.md](modules/05-hook-system.md) | Hook system |
| [06-pipeline-runner.md](modules/06-pipeline-runner.md) | Pipeline runner |
| [07-evaluation.md](modules/07-evaluation.md) | Evaluation system |
| [08-self-improving.md](modules/08-self-improving.md) | Self-improving loop |
| [09-knowledge-system.md](modules/09-knowledge-system.md) | Knowledge system (capture, retrieval, graduation) |

Supplementary runtime notes:

- [docs/user-requirement-runtime-sequence.md](docs/user-requirement-runtime-sequence.md): How a user requirement actually flows through the current system

---

## License

MIT
