# Reins

Constraint governance for AI coding agents. Reins scans your project, generates constraints, enforces them via hooks, captures knowledge, and evolves continuously.

中文说明请见: [README.zh-CN.md](README.zh-CN.md)

---

## The Problem

AI coding agents such as Claude Code, Cursor, and Copilot share a fundamental gap: they do not know your project.

They do not know:
- This project uses Prisma, not raw SQL
- Changing `payment` requires syncing the webhook handler
- Error handling uses the `Result` type, not `try/catch`
- Edge Runtime cannot use the standard Prisma client

Every new session starts from zero, and the same mistakes repeat.

**Reins fixes this.** It scans your project, extracts constraints, generates multi-format context files, enforces them via hooks, and captures new knowledge after each task so constraints evolve with your project.

---

## How It Works

```text
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
npx reins init

# Preview without writing files
npx reins init --dry-run

# Generate only L0 (top-level CLAUDE.md)
npx reins init --depth L0
```

After `reins init`, your project gets:

```text
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

### 1. CLI + State

Unified command entry manages the constraint lifecycle (`init → develop → update → rollback`). Snapshot-based state enables rollback to any point in time.

### 2. Scanner

Analyzes directory structure, dependencies, and framework characteristics. Outputs `context.json` and `manifest.json` as input for constraint generation. Supports six scan depths (`L0-L5`).

### 3. Constraint Generator

Consumes scanner output, infers project constraints, and writes `constraints.yaml`. Supports multiple profiles (`strict`, `default`, `relaxed`, `ci`) and tech stack templates (TypeScript, Python, Go, Rust, Java).

### 4. Progressive Context Generator

Renders `constraints.yaml` into multi-format context files. The three-layer model (`L0/L1/L2`) controls information density so agents get exactly what they need and nothing more.

### 5. Hook System

Generates Claude Code hook scripts (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`). Enforces constraints deterministically before and after agent operations. Supports three modes: `block`, `warn`, `off`.

### 6. Pipeline Runner

`reins develop <task>` is intended to drive the full development pipeline: constraint injection, planning, execution, review, and QA. Every stage runs under constraints.

### 7. Evaluation System

Five-layer verification: `L0` (static checks) → `L1` (coverage gate) → `L2` (integration verify) → `L3` (E2E) → `L4` (semantic review). Exit conditions are profile-based.

### 8. Self-Improving Loop

`OBSERVE → ANALYZE → LEARN → CONSTRAIN` closed loop. Analyzes execution logs, detects recurring error patterns, auto-applies high-confidence improvements, and suggests medium-confidence ones.

### 9. Knowledge System

Captures agent experience and converts it into expertise. Structured reflection after task completion stores couplings, gotchas, decisions, and preferences into `.reins/knowledge/`. Relevant knowledge is auto-injected on the next task. High-confidence knowledge graduates into formal constraints.

---

## Commands

| Command | Description |
|---------|-------------|
| `reins init` | Scan project, generate constraints and context files |
| `reins develop <task>` | Auto-develop under constraints *(not yet available)* |
| `reins status` | View constraint status and statistics |
| `reins update` | Incrementally update constraints from the latest scan |
| `reins test` | Test constraints and hooks |
| `reins rollback` | Roll back to a specific snapshot |
| `reins learn` | Save knowledge learned from the current session |
| `reins analyze` | Analyze execution history and surface improvement suggestions |
| `reins hook` | Manage hooks |

```bash
reins init --dry-run              # Preview, no file writes
reins init --depth L0             # Only generate top-level CLAUDE.md
reins status --format json        # JSON output
reins update --auto-apply         # Auto-apply non-conflicting updates
reins rollback --to <snapshot>    # Roll back to snapshot
reins learn --auto                # Full OBSERVE → ANALYZE → LEARN pipeline
reins hook list                   # List all hooks
reins hook add "no raw SQL"       # Add a new hook from description
reins hook disable <id>           # Disable a specific hook
```

---

## Progressive Context Design (`L0 / L1 / L2`)

An agent's context window is scarce. Do not dump all constraints at once.

```text
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
    Goal: deep reference when an agent needs it, never preloaded.
    Budget: unlimited, file-separated.
```

These three layers ensure agents always have enough context without being drowned in irrelevant information.

---

## Knowledge System

Traditional constraints are static. Reins' knowledge system lets constraints grow with your project.

### Four Knowledge Types

| Type | Example | Source |
|------|---------|--------|
| `coupling` | `auth and webhook share session store` | Post-task reflection |
| `gotcha` | `Prisma doesn't work in Edge Runtime` | Failure retry |
| `decision` | `Chose Redis for pub/sub` | Post-task reflection |
| `preference` | `User prefers functional style, avoid classes` | User correction |

### Three Capture Triggers

- After task completion: the `Stop` hook triggers structured reflection
- On user correction: expectation-gap signals are extracted into principles
- After failure retry: negative knowledge is captured when an approach changes after failure

### Retrieval & Injection

Knowledge is auto-injected via the `UserPromptSubmit` hook using file-affinity retrieval. Injection format is summary plus path reference, and the agent can read the full knowledge file when needed.

### Knowledge Graduation

```text
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

```text
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
│   ├── adapters/           # Multi-format output adapters
│   └── state/              # Config + manifest + snapshot
├── modules/                # Design documents
├── docs/                   # Supplementary docs
└── openspec/               # OpenSpec change archive
```

---

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build (tsc strict mode)
pnpm dev -- init    # Dev mode (tsx, no build needed)
pnpm test           # Run tests (vitest)
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
| [04-context-generator.md](modules/04-context-generator.md) | Progressive context (`L0/L1/L2`) |
| [05-hook-system.md](modules/05-hook-system.md) | Hook system |
| [06-pipeline-runner.md](modules/06-pipeline-runner.md) | Pipeline runner |
| [07-evaluation.md](modules/07-evaluation.md) | Evaluation system |
| [08-self-improving.md](modules/08-self-improving.md) | Self-improving loop |
| [09-knowledge-system.md](modules/09-knowledge-system.md) | Knowledge system (capture, retrieval, graduation) |

Supplementary runtime notes:

- [docs/user-requirement-runtime-sequence.md](docs/user-requirement-runtime-sequence.md): How a user requirement actually flows through the current system
- [docs/install-and-init-distribution.md](docs/install-and-init-distribution.md): Why Reins should support both `npx` and global install, and make `init` the core product flow

---

## License

MIT
