## Context

This change introduces `reins ship` — a batch feature orchestrator that drives a headless Claude Code subprocess through implementation + verification loops for each feature in `.reins/features/`. It builds directly on the architecture landed in the previous change (commit `4f986c9`), which established the principle that **the CLI never calls an LLM in-process** and all LLM work happens in the user's IDE.

`reins ship` does not break this principle — it spawns `claude -p <prompt>` as a child process. The reins runtime's responsibility is the *outer loop*: feature queue state, prompt assembly, failure capture, retry budget, verification gating. Code generation is always done by Claude Code (or another headless agent, post-v1).

Relevant existing structures:

- `ConstraintsConfig` and `PipelineConfig` in `src/constraints/schema.ts` — `pipeline.pre_commit` is the only current pipeline slot; this change adds two more.
- `src/workflows/` — slash command templates registered via `src/adapters/claude-md.ts` into `.claude/commands/reins/*.md`. This change adds two more workflows.
- `src/gate/stop.ts` — runs `pipeline.pre_commit` verbatim at every Stop hook. Unchanged by this change, but `pipeline.feature_verify` and `pipeline.browser_verify` are **deliberately not read by gate-stop** — they belong to ship, not hook.
- `src/state/config.ts` — the `.reins/config.yaml` schema. This change adds a `ship` section.
- `src/commands/init.ts` — creates `.reins/` skeleton at init. This change adds a `features/` subdirectory.
- `src/scanner/scan.ts` — project scanner. Unused by ship.

Relevant external dependencies:

- **`claude` CLI** must be on PATH, supporting `-p <prompt>` (headless print mode). v1 assumes this unconditionally. Provider abstraction (codex, cursor, opencode) is a post-v1 concern.
- **`git`** for worktree operations (parallel steps), `git log --oneline` (commit convention detection), `git cherry-pick` (rebase-back), and `git status --porcelain` (scope drift detection).
- **Playwright** for v2 browser verify. ship does not install Playwright — it detects the project already has it and fails gracefully if not.

## Goals / Non-Goals

**Goals (v1 — this change):**
- Feature file format (`.reins/features/<id>.md`) with YAML frontmatter state machine.
- `reins feature new/list/show/status/set-status/next` — pure structured CRUD, no LLM.
- **Planning phase**: single `claude -p` call analyzes all todo features and outputs a JSON execution DAG (which features can run in parallel vs serial). Falls back to `depends_on`-based serial order if JSON is malformed or scopes conflict.
- **Worktree isolation for parallel steps**: each parallel feature gets `.reins/wt/<id>/` worktree; serial steps run in the current branch.
- **Auto-commit on success**: `feature_verify` pass → `git add -A && git commit -m <detected-convention>`; pre-commit hook failure is treated as a verify failure and retried.
- `reins ship` orchestrator: loop through the plan's steps, spawn Claude Code per feature, run `pre_commit` + `feature_verify`, commit on success, rebase parallel worktrees back to the base branch, move to next step.
- `pipeline.feature_verify: string[]` schema extension.
- Headless Claude Code spawn wrapper with timeout, cancellation, log capture.
- Failure feedback: failed verify output is fed back into the next `claude -p` call.
- Scope drift detection: warn in serial mode, **block in parallel mode** (drift pollutes other worktrees' rebase).
- `.reins/runs/<iso-timestamp>/` run log directory with per-attempt artifacts + planning DAG JSON + rebase logs.
- `/reins-feature-new` slash command.
- `/reins-ship-here` slash command (single-feature, foreground, for debugging).

**Goals (v2 — follow-up change, scoped but not implemented here):**
- `pipeline.browser_verify` schema + runner.
- Playwright spec auto-generation via a second `claude -p` call ("write a spec at `<path>` that tests the following: …").
- Dev server lifecycle (start → wait_for_url → run tests → kill) with **AI-driven discovery** when `browser_verify.dev_server` is missing — spawn claude to analyze the project, persist the discovered command back to `constraints.yaml`.

**Non-Goals (explicit):**
- **Not a CI/CD tool.** Ship is a developer-loop tool. CI runs the committed code through the project's existing CI pipeline.
- **No feature planning or generation from prose.** Users write feature files themselves (optionally via `/reins-feature-new` in an IDE). reins never turns "I want these features" free-form text into feature files — that's what `/reins-feature-new` handles interactively. Ship's planning phase only decides **execution order**, not feature content.
- **No multi-LLM provider abstraction in v1.** Only `claude` CLI. The spawn wrapper's interface leaves room for a provider enum post-v1.
- **No visual AI judge for browser verify.** No "does this screenshot look right" calls. Structured Playwright assertions only.
- **No computer-use / browser-use agent loops.** Only Playwright specs run via the project's Playwright installation.
- **No auto-push, no auto-PR, no auto-merge to a shipping branch.** Auto-commit leaves the commits on the current branch (or rebased from worktrees). User decides when to push.
- **No `--no-verify` bypass of project hooks.** Project pre-commit hooks are respected. If they're heavy, that's the project's policy, not reins's problem.
- **No automatic resolution of rebase conflicts.** Conflict → stop, mark blocked, preserve worktree for user.
- **No auth / credential management.** If a feature's verify needs secrets, user arranges them via their usual `.env` / shell export; ship inherits the environment.
- **No telemetry.** Run logs are local-only in `.reins/runs/`.

## Decisions

### 1. Feature file format

Markdown file with YAML frontmatter. The filename without `.md` is the feature id. Filename pattern: `<3-digit-order>-<kebab-case>.md` recommended but not enforced (e.g. `001-add-login.md`).

```yaml
---
id: 001-add-login
title: Email + password login
status: draft            # draft | todo | in-progress | implemented | verified | done | blocked
priority: 1              # lower = higher priority
depends_on: []           # [<id>, ...] — this feature waits for these to be 'done'
max_attempts: 3          # per-feature override of ship default
scope:                   # optional file globs; used for drift detection
  - app/backend/src/auth/**
  - app/frontend/src/pages/login/**
created_at: 2026-04-07T10:00:00Z
updated_at: 2026-04-07T10:00:00Z
last_run_id: null        # set by ship runner to the run directory basename
last_failure: null       # set by ship runner on blocked; {stage, command, exit_code, trace_tail}
---

## What
<free-form prose — what the feature is and why it matters>

## Acceptance
- [ ] <observable checklist>
- [ ] ...

## Backend contract
<API shape, if applicable>

## Browser test
<natural-language description of how a human would click through to verify;
 consumed by v2 browser verify to generate a Playwright spec>

## Notes
<filled by ship runner on retry — what was tried, what failed, what was learned>
```

**Parser contract:** `src/features/parser.ts` exports `parseFeatureFile(path): Feature | null`. It:
1. Reads the file.
2. Parses frontmatter with js-yaml.
3. Validates required fields (id, title, status).
4. Validates `status` is one of the allowed values.
5. Validates `depends_on` items are strings.
6. Returns `null` with a warning for invalid files (ship skips them, does not crash).

**Writer contract:** `src/features/storage.ts` exports `updateFeatureFrontmatter(path, patch)`. It:
1. Reads the file.
2. Parses frontmatter only (body is byte-preserved).
3. Merges patch into frontmatter.
4. Bumps `updated_at`.
5. Writes back with original body intact.

The body is never rewritten by reins; only the user or Claude Code touches it (via "append to Notes" instructions).

### 2. Feature status state machine

```
draft ──(ready)──> todo ──(ship picks up)──> in-progress
                                                ├─(implement success + verify pass)──> done
                                                ├─(implement success + verify fail ≤ N)──> in-progress (retry)
                                                └─(attempts exhausted)──> blocked
                                                
done ──(user rollback)──> todo
blocked ──(user fixes)──> todo
```

**State semantics:**

| Status | Meaning | Who sets it |
|---|---|---|
| `draft` | Written but not ready — author still editing | User |
| `todo` | Ready to ship | User (`reins feature set-status <id> todo`) |
| `in-progress` | Ship runner is actively working on it | Ship runner |
| `implemented` | Claude Code claims it finished the code but verify not yet run | Ship runner (internal, rarely observed) |
| `verified` | Verify passed | Ship runner (internal, transient) |
| `done` | Ship runner finalized; user may commit | Ship runner |
| `blocked` | max_attempts exhausted or fatal error; last_failure populated | Ship runner |

Only `todo` features are picked up by `reins ship`. `draft` is deliberately excluded so users can write specs without worrying about ship racing them.

### 3. Dependency resolution (`reins feature next`)

```ts
function pickNextFeature(features: Feature[]): Feature | null {
  const todo = features.filter(f => f.status === 'todo');
  const doneIds = new Set(features.filter(f => f.status === 'done').map(f => f.id));

  const ready = todo.filter(f =>
    f.depends_on.every(depId => doneIds.has(depId))
  );

  if (ready.length === 0) return null;

  // Cycle detection
  if (hasCycle(features)) {
    throw new Error('Dependency cycle detected');
  }

  // Sort by priority ascending, then by created_at
  ready.sort((a, b) => (a.priority - b.priority) || a.created_at.localeCompare(b.created_at));
  return ready[0] ?? null;
}
```

Cycle detection is cheap — O(V+E) DFS — and runs once per `ship` invocation.

### 4. Headless Claude Code spawn contract

`src/ship/claude-spawn.ts` exports:

```ts
export interface ClaudeRunOptions {
  cwd: string;
  timeoutMs: number;            // default 600_000 (10 min)
  env?: Record<string, string>; // merged with process.env
  signal?: AbortSignal;         // for Ctrl+C propagation
  logDir: string;               // where to write attempt-N.log
}

export interface ClaudeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  tokenUsage?: { input: number; output: number }; // parsed from tail if present
  timedOut: boolean;
}

export async function spawnClaudeHeadless(
  prompt: string,
  opts: ClaudeRunOptions,
): Promise<ClaudeRunResult>;
```

Implementation:

```ts
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function spawnClaudeHeadless(
  prompt: string,
  opts: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  const startedAt = Date.now();
  const child = spawn('claude', ['-p', prompt], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000);
  }, opts.timeoutMs);

  opts.signal?.addEventListener('abort', () => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });

  const exitCode: number = await new Promise(resolve => {
    child.on('exit', code => resolve(code ?? -1));
  });
  clearTimeout(timeoutHandle);

  const durationMs = Date.now() - startedAt;
  const tokenUsage = parseTokenUsage(stdout);

  // Persist attempt log
  writeFileSync(
    join(opts.logDir, `claude-${startedAt}.log`),
    `EXIT: ${exitCode}\nDURATION: ${durationMs}ms\nPROMPT:\n${prompt}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
  );

  return { exitCode, stdout, stderr, durationMs, tokenUsage, timedOut };
}
```

**Ship runner treats `exitCode === 0` as "Claude Code completed the turn."** It does NOT mean "the feature is done" — that's determined by the verify layer.

**Token usage parsing** is best-effort: Claude Code CLI's output format may change, so `parseTokenUsage` uses a defensive regex and returns `undefined` on mismatch. Never throws.

### 5. Three-layer verify: pre_commit vs feature_verify vs browser_verify

Strict separation by **cadence** and **cost**:

| Layer | Cadence | Target cost | Blocks what | Who reads it |
|---|---|---|---|---|
| `pre_commit` | Every Stop hook (i.e. every Claude Code turn) | < 60s | Current turn | `gate-stop` (already exists) |
| `feature_verify` | Once per feature, after each implement attempt | 1-5 min | Current feature | `reins ship` (new) |
| `browser_verify` | Once per feature, after feature_verify passes (v2) | 2-15 min | Current feature | `reins ship` (new) |

**Why three layers and not two:** merging `feature_verify` into `pre_commit` would run full unit tests on every chat turn — unusable. Merging `browser_verify` into `feature_verify` would force dev server startup on every feature_verify attempt — wasteful because feature_verify can retry many times while the spec has to be written only once.

**Schema extension to `src/constraints/schema.ts`:**

```ts
export interface PipelineConfig {
  pre_commit: string[];
  feature_verify?: string[];        // new, optional
  browser_verify?: BrowserVerifyConfig; // new, optional (v2 only reads it)
}

export interface BrowserVerifyConfig {
  command: string;
  spec_dir: string;
  dev_server?: DevServerConfig;
}

export interface DevServerConfig {
  command: string;
  wait_for_url: string;
  timeout_ms: number;
  kill_signal?: 'SIGINT' | 'SIGTERM' | 'SIGKILL'; // default SIGTERM
}
```

All new fields optional → existing `constraints.yaml` files continue to parse. Weaver's current config stays valid.

**ship runner reading rules:**

```ts
// In src/ship/verify.ts
async function runFeatureVerify(projectRoot: string): Promise<VerifyResult> {
  const config = loadConstraintsConfig(projectRoot);
  const commands = config.pipeline.feature_verify ?? [];
  if (commands.length === 0) return { passed: true, skipped: true, reason: 'no feature_verify configured' };
  // run each command, short-circuit on first failure, collect stdout/stderr
}

async function runPreCommit(projectRoot: string): Promise<VerifyResult> {
  // Same logic but for pre_commit. Ship runs this BEFORE feature_verify
  // to catch fast lint/typecheck errors before committing to minute-long tests.
}
```

### 6. Ship runner state machine

**Top level (orchestrator) — `runShip`:**

```
runShip(projectRoot, opts):
  1. Load all features; filter to status==todo (+ opts.only filter if present)
  2. Create run dir .reins/runs/<iso>
  3. Acquire .reins/runs/.lock (fail if another ship is running)
  4. Install SIGINT handler
  5. plan = planExecution(projectRoot, features, maxParallelism, runDir)
  6. Write plan JSON to runDir/plan.json
  7. Print plan summary (steps, parallelism, estimated minutes) + --dry-run early-out
  8. For each step in plan.steps:
       if step.mode == 'serial':
         for feature in step.features:
           result = runFeature(feature, projectRoot, runDir, ctx)
           record(result)
           if result.status == 'blocked': # continue to next feature in this step
             continue
       else:  # parallel
         result = runParallelStep(step, projectRoot, runDir, ctx)
         record(result)
         if any feature in result is 'blocked':
           # Pause ship: subsequent steps may depend on blocked features
           break
  9. Write run.json summary
  10. Release lock
  11. Print final report
```

**Per-feature (serial or inside a worktree) — `runFeature`:**

```
runFeature(feature, cwd, runDir, ctx):
  set-status in-progress
  attempts = 0
  previousFailure = undefined

  loop:
    attempts += 1
    prompt = build_implement_prompt(feature, previousFailure)
    claude_result = spawn_claude_headless(prompt, cwd=cwd, logDir=runDir/<id>/attempt-N)

    if claude_result.exit_code != 0:
      previousFailure = { stage: 'claude', ... }
      if attempts >= max_attempts: status=blocked, break
      continue

    scope_drift = check_git_scope_drift(cwd, feature.scope)
    if scope_drift.outOfScope.length > 0:
      if ctx.isParallel: 
        # block: drift pollutes other worktrees' rebase
        previousFailure = { stage: 'scope-drift', output: scope_drift.outOfScope.join('\n') }
        if attempts >= max_attempts: status=blocked, break
        continue
      else:
        log warning

    pre_commit_result = run_pre_commit(cwd)
    if not pre_commit_result.passed:
      previousFailure = { stage: 'pre_commit', ... }
      if attempts >= max_attempts: status=blocked, break
      continue

    feature_verify_result = run_feature_verify(cwd)
    if not feature_verify_result.passed:
      previousFailure = { stage: 'feature_verify', ... }
      if attempts >= max_attempts: status=blocked, break
      continue

    # v2: browser_verify here

    if ctx.config.ship.auto_commit:
      commit_result = commit_feature(cwd, feature, runId, attempts, style)
      if not commit_result.success:
        # pre-commit hook rejected — treat as verify failure, retry
        previousFailure = { stage: 'commit', output: commit_result.hookOutput }
        if attempts >= max_attempts: status=blocked, break
        continue

    set-status done
    break
```

**Parallel step — `runParallelStep`** (see Decision 12 for full implementation):

```
runParallelStep(step, projectRoot, runDir, ctx):
  handles = [createWorktree(projectRoot, id) for id in step.features]
  results = pLimit(ctx.maxParallelism, handles.map(h => runFeature(feature, h.path, runDir, {...ctx, isParallel: true})))
  
  for each successful result:
    rebase = rebaseAndMerge(projectRoot, handle)
    if rebase conflict:
      mark result as blocked with stage='rebase'
    else:
      removeWorktree(handle)
  
  # Keep failed worktrees for inspection; log paths
  return { successful, failed }
```

Implemented in `src/ship/runner.ts` with clear inter-step logging. Each of `runShip`, `runParallelStep`, `runFeature` is a separate async function with narrow inputs so they can be unit tested independently.

**Mtime guard:** before each feature starts, snapshot the mtime of all feature files. If the feature *currently being processed* changes mid-run → abort that feature (not the whole ship). If unrelated feature files change → log but continue.

### 7. Failure feedback prompt assembly

`src/ship/prompt-builder.ts`:

```ts
export function buildImplementPrompt(
  feature: Feature,
  projectRoot: string,
  previousFailure?: FailureContext,
): string {
  const constraints = loadImportantConstraints(projectRoot);
  const featureBody = readFeatureBody(feature);

  const sections: string[] = [];

  sections.push(`# Implementation task: ${feature.title}`);
  sections.push('');
  sections.push(featureBody);
  sections.push('');

  if (constraints.length > 0) {
    sections.push('## Project constraints (do not violate)');
    for (const c of constraints) {
      sections.push(`- [${c.severity}] ${c.rule}`);
    }
    sections.push('');
  }

  if (previousFailure) {
    sections.push('## Previous attempt failed');
    sections.push('');
    sections.push(`Stage: ${previousFailure.stage}`);
    sections.push(`Command: \`${previousFailure.command}\``);
    sections.push(`Exit code: ${previousFailure.exitCode}`);
    sections.push('');
    sections.push('Output (last 100 lines):');
    sections.push('```');
    sections.push(tail(previousFailure.output, 100));
    sections.push('```');
    sections.push('');
    sections.push('**Fix the code so this command passes. Do not weaken the tests, do not skip them, do not add exceptions.**');
    sections.push('');
  }

  sections.push('## When done');
  sections.push('');
  sections.push('Append a short note under the `## Notes` section of');
  sections.push(`\`.reins/features/${feature.id}.md\` describing what you changed and why.`);
  sections.push('Do not modify any other field in that file.');

  return sections.join('\n');
}
```

**Key choices:**
- Constraints are included every attempt — stateless prompt, robust to context resets inside Claude Code.
- Failure output is tail-limited to 100 lines to keep prompts sub-token-budget.
- Explicit "do not weaken the tests" is the single most important sentence. Without it, models will cheat on ~15% of failures.

### 8. Scope drift detection

```ts
// src/ship/drift-check.ts
import { execSync } from 'node:child_process';
import { minimatch } from 'minimatch'; // dependency already in adapters

export interface DriftResult {
  touchedFiles: string[];
  outOfScope: string[];
}

export function checkScopeDrift(
  projectRoot: string,
  scopeGlobs: string[] | undefined,
): DriftResult {
  if (!scopeGlobs || scopeGlobs.length === 0) {
    return { touchedFiles: [], outOfScope: [] };
  }

  const porcelain = execSync('git status --porcelain', {
    cwd: projectRoot, encoding: 'utf-8',
  });
  const touchedFiles = porcelain.split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())
    .filter(Boolean);

  const outOfScope = touchedFiles.filter(f =>
    !scopeGlobs.some(glob => minimatch(f, glob))
  );

  return { touchedFiles, outOfScope };
}
```

**Drift is a warning, not a blocker.** Sometimes a feature legitimately needs to touch a shared helper. Logging it lets the user decide.

Dependency check: `minimatch` is already in the project (used by adapters for glob matching). No new dep.

### 9. Run log directory layout

```
.reins/runs/
└── 2026-04-07T21-30-00Z/
    ├── run.json               # top-level summary: features attempted, status, total duration, total tokens
    ├── 001-add-login/
    │   ├── attempt-1/
    │   │   ├── implement-prompt.md
    │   │   ├── claude-1696000000.log
    │   │   ├── pre_commit-output.log
    │   │   └── feature_verify-output.log
    │   ├── attempt-2/
    │   │   └── ...
    │   └── result.json        # final status, last_failure, timings, tokens
    └── 002-dark-mode/
        └── ...
```

**`run.json` schema:**

```ts
interface RunSummary {
  id: string;                       // ISO timestamp basename
  started_at: string;
  finished_at: string;
  duration_ms: number;
  features: Array<{
    id: string;
    status: 'done' | 'blocked';
    attempts: number;
    duration_ms: number;
    token_usage?: { input: number; output: number };
    failure?: { stage: string; command: string; exit_code: number };
  }>;
  totals: {
    done: number;
    blocked: number;
    duration_ms: number;
    token_usage?: { input: number; output: number };
  };
}
```

`reins ship --show-last` (post-v1 nice-to-have) would read the most recent `run.json` and pretty-print it.

### 10. Ship config section (`.reins/config.yaml`)

Add to `ReinsConfig` in `src/state/config.ts`:

```ts
export interface ShipConfig {
  default_max_attempts: number;       // default 3
  implement_timeout_ms: number;       // default 600_000 (10 min)
  feature_verify_timeout_ms: number;  // default 600_000
  log_retention_days: number;         // default 30
  abort_on_scope_drift: boolean;      // default false for serial, always true for parallel
  max_parallelism: number;            // default 3; --parallel N overrides
  planner_enabled: boolean;           // default true; set false to skip planning step
  auto_commit: boolean;               // default true; --no-commit overrides
  commit_style: 'auto' | 'conventional' | 'free' | 'custom'; // default 'auto'
  commit_custom_template?: string;    // used when commit_style === 'custom'
}

export interface ReinsConfig {
  // ... existing fields
  ship?: ShipConfig;
}
```

Defaults are baked into `getDefaultConfig()`. User can override in `.reins/config.yaml`. No user is required to configure anything — `reins ship` works out of the box with sensible defaults.

### 11. Planning phase

`src/ship/planner.ts` exports:

```ts
export interface ExecutionStep {
  mode: 'serial' | 'parallel';
  features: string[];      // feature ids
  reason: string;           // planner's justification
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  parallelism: number;      // max concurrent within any parallel step
  estimated_minutes: number;
  source: 'ai' | 'fallback'; // ai = claude planner, fallback = depends_on-based
}

export async function planExecution(
  projectRoot: string,
  features: Feature[],
  maxParallelism: number,
  runDir: string,
): Promise<ExecutionPlan>;
```

**Algorithm:**

1. If `config.ship.planner_enabled === false` or feature count ≤ 1 → skip planning, return `source: 'fallback'` with one serial step per feature (ordered by `depends_on` + priority).
2. Build a planning prompt: frontmatter of each feature + body first 500 chars + declared `scope` globs + a list of already-`done` features.
3. Spawn `claude -p <prompt>` with a short timeout (default 120s) and a small model preference (pass `--model haiku` or `--model sonnet` if the CLI supports it — fall back to default if not).
4. Parse response as JSON against a strict schema. On any parse or validation error → log the raw response to `runDir/planner-raw.log` and return fallback plan.
5. **Post-validate** the AI plan:
   - Every feature id in `steps` must exist in the input and be status `todo`
   - Every `todo` feature must appear exactly once across all steps
   - Steps must respect `depends_on` (dep must be in an earlier step or already done)
   - Within each parallel step, check scope overlap: if two features both declare globs that could match the same path (minimatch intersection check), split the step (move one to a new serial step after)
6. If post-validation has to split → log the split and continue with the modified plan
7. Clamp `parallelism` to `min(plan.parallelism, maxParallelism)`
8. Return plan with `source: 'ai'`

**Planning prompt template:**

```
You are planning the execution order of several code-change features in a single
codebase. Your ONLY job is to decide which features can run in parallel vs
serially, so Reins can schedule them efficiently without introducing merge
conflicts or dependency violations.

Return ONLY a JSON object matching this schema:
{
  "steps": [
    {"mode": "serial" | "parallel", "features": ["<id>", ...], "reason": "<one sentence>"}
  ],
  "parallelism": <integer, max features allowed in any parallel step>,
  "estimated_minutes": <rough total walltime estimate>
}

Rules:
- Every feature id in the input list must appear in exactly one step.
- Respect depends_on: a dependent feature cannot appear in a step before its dep.
- Put features in the same parallel step ONLY if they clearly touch different
  files or modules. When in doubt, make them serial.
- parallelism should be <= <max_parallelism>.
- DO NOT explain your reasoning outside the JSON. DO NOT output markdown fences.

Features:
<feature-list as JSON>

Already-done features (for dependency context):
<done feature ids>
```

**Scope overlap detection** in post-validation uses `minimatch` — for each pair (A, B) in a parallel step, if any glob in A matches the glob pattern of B (or vice versa), treat as overlap. This is heuristic; actual file conflicts can still happen, caught later by rebase.

### 12. Worktree lifecycle

`src/ship/worktree.ts` exports:

```ts
export interface WorktreeHandle {
  featureId: string;
  path: string;           // absolute path to the worktree
  branchName: string;     // internal branch name, e.g. reins/feature-001
  baseCommit: string;     // sha of where we branched from
}

export async function createWorktree(
  projectRoot: string,
  featureId: string,
  baseBranch?: string,   // defaults to current HEAD
): Promise<WorktreeHandle>;

export async function rebaseAndMerge(
  projectRoot: string,
  handle: WorktreeHandle,
): Promise<{ success: true } | { success: false; conflict: string }>;

export async function removeWorktree(
  handle: WorktreeHandle,
  force: boolean,
): Promise<void>;
```

**Create flow:**

```bash
git -C <projectRoot> worktree add -b reins/feature-<id> .reins/wt/<id> HEAD
```

**Rebase-back flow (at end of parallel step, per feature):**

```bash
# In projectRoot (the main checkout):
git fetch .reins/wt/<id> reins/feature-<id>
git cherry-pick <commit-sha-from-worktree>
# If cherry-pick conflicts → abort, return conflict marker
git cherry-pick --abort
```

We use `cherry-pick` not `rebase` because each worktree has exactly one commit per feature (or a handful). cherry-pick is simpler and the conflict surface is identical.

**Parallel step orchestration:**

```ts
// In runner.ts
async function runParallelStep(step: ExecutionStep, ctx: RunContext): Promise<StepResult> {
  const handles = await Promise.all(
    step.features.map(id => createWorktree(ctx.projectRoot, id))
  );

  // Implement + verify + commit in parallel, capped at config.ship.max_parallelism
  const results = await pLimit(ctx.maxParallelism)(
    handles.map(h => () => runFeatureInWorktree(h, ctx))
  );

  // After all parallel features finish, rebase successful ones back
  const successful = results.filter(r => r.status === 'done');
  const failed = results.filter(r => r.status !== 'done');

  for (const r of successful) {
    const rebase = await rebaseAndMerge(ctx.projectRoot, r.handle);
    if (!rebase.success) {
      // Conflict — mark this feature as blocked, keep worktree
      r.status = 'blocked';
      r.failure = { stage: 'rebase', command: 'git cherry-pick', exit_code: 1, output: rebase.conflict };
    } else {
      await removeWorktree(r.handle, false);
    }
  }

  // Keep failed worktrees for user inspection
  for (const r of failed) {
    // Don't remove; log the path
    ctx.logger.warn(`Feature ${r.featureId} blocked; worktree preserved at ${r.handle.path}`);
  }

  return { successful, failed };
}
```

**`pLimit` implementation**: we don't need a dependency — a 15-line inline promise-pool is enough. Documented in task 6.3.

**Cleanup on Ctrl+C:** SIGINT handler walks all active handles and does NOT remove worktrees (user may want to inspect), but does kill any running `claude` subprocess inside them via the abort signal mechanism.

### 13. Auto-commit with convention detection

`src/ship/commit.ts` exports:

```ts
export type CommitStyle = 'conventional' | 'free' | 'custom';

export async function detectCommitStyle(
  projectRoot: string,
  override: ShipConfig['commit_style'],
): Promise<CommitStyle>;

export function buildCommitMessage(
  feature: Feature,
  runId: string,
  attempts: number,
  style: CommitStyle,
  template?: string,
): string;

export async function commitFeature(
  cwd: string,                    // main checkout or worktree path
  feature: Feature,
  runId: string,
  attempts: number,
  style: CommitStyle,
  template?: string,
): Promise<{ success: true; sha: string } | { success: false; hookOutput: string }>;
```

**`detectCommitStyle` logic:**

```ts
async function detectCommitStyle(projectRoot, override) {
  if (override !== 'auto') return override;

  const log = execSync('git log --oneline -20', { cwd: projectRoot, encoding: 'utf-8' });
  const lines = log.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return 'free';

  // Strip the sha prefix, match against conventional pattern
  const conventionalPattern = /^[a-f0-9]+ (feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]+\))?(!)?: /;
  const matches = lines.filter(line => conventionalPattern.test(line)).length;

  return matches / lines.length >= 0.8 ? 'conventional' : 'free';
}
```

**`buildCommitMessage`:**

```ts
function buildCommitMessage(feature, runId, attempts, style, template) {
  const footer = [
    '',
    `Reins-feature-id: ${feature.id}`,
    `Reins-run-id: ${runId}`,
    `Reins-attempts: ${attempts}`,
  ].join('\n');

  if (style === 'custom' && template) {
    // Template placeholders: {title}, {id}, {run_id}, {attempts}
    return template
      .replace('{title}', feature.title)
      .replace('{id}', feature.id)
      .replace('{run_id}', runId)
      .replace('{attempts}', String(attempts));
  }

  if (style === 'conventional') {
    return `feat: ${feature.title}${footer}`;
  }

  // free
  return `${feature.title}${footer}`;
}
```

**`commitFeature`:**

```ts
async function commitFeature(cwd, feature, runId, attempts, style, template) {
  execSync('git add -A', { cwd });

  const message = buildCommitMessage(feature, runId, attempts, style, template);

  try {
    execSync('git commit -m ' + shellEscape(message), { cwd });
    const sha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    return { success: true, sha };
  } catch (err) {
    // Pre-commit hook rejected, or nothing to commit, or other git failure
    const e = err as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
    const combined = `${typeof e.stdout === 'string' ? e.stdout : ''}\n${typeof e.stderr === 'string' ? e.stderr : ''}`.trim();
    return { success: false, hookOutput: combined.slice(0, 4000) };
  }
}
```

**Ship runner integration** (in `runFeature`):

```ts
// after feature_verify passes
if (ctx.config.ship?.auto_commit ?? true) {
  const result = await commitFeature(cwd, feature, runId, attempts, style, template);
  if (!result.success) {
    // Treat as verify failure, retry with hook output in next prompt
    previousFailure = {
      stage: 'commit',
      command: 'git commit',
      exit_code: 1,
      output: result.hookOutput,
    };
    if (attempts >= maxAttempts) {
      await updateFeatureFrontmatter(featurePath, {
        status: 'blocked',
        last_failure: previousFailure,
      });
      return { status: 'blocked', featureId: feature.id, ... };
    }
    continue; // retry implement
  }
  // commit succeeded; record sha
  attemptResult.commitSha = result.sha;
}
```

### 14. AI-driven dev server discovery (v2 foreshadowing)

Not implemented in this change, but the schema and flow are reserved here:

```ts
// src/ship/dev-server.ts (v2)
export async function discoverDevServer(
  projectRoot: string,
  runDir: string,
): Promise<DevServerConfig | null> {
  const prompt = buildDevServerDiscoveryPrompt(projectRoot);
  const result = await spawnClaudeHeadless(prompt, {
    cwd: projectRoot,
    timeoutMs: 120_000,
    logDir: runDir,
  });

  // Parse JSON; validate fields; return DevServerConfig or null on failure
  // On success, write back to constraints.yaml under pipeline.browser_verify.dev_server
}
```

The discovery prompt includes: `package.json` scripts, `Makefile` targets (if present), `docker-compose.yml` services (if present), README first 100 lines. It asks for JSON output only.

v2's `browser_verify` runner checks `pipeline.browser_verify.dev_server`: if present, start the server; if not, call `discoverDevServer` and retry. If discovery fails, skip browser_verify with reason "unconfigured" and mark feature `done` (not `blocked`) — browser_verify is best-effort in v2.

## File Structure

```
src/
├── features/
│   ├── index.ts            # public API: load, save, list, next
│   ├── types.ts            # Feature, FeatureStatus, FailureContext
│   ├── parser.ts           # parseFeatureFile
│   ├── storage.ts          # writeFeature, updateFeatureFrontmatter
│   ├── resolver.ts         # pickNextFeature, hasCycle
│   └── features.test.ts
├── ship/
│   ├── index.ts            # runShip(projectRoot, opts): Promise<RunSummary>
│   ├── runner.ts           # per-feature state machine, per-step orchestration
│   ├── planner.ts          # planExecution — AI DAG planner + fallback
│   ├── worktree.ts         # createWorktree, rebaseAndMerge, removeWorktree
│   ├── commit.ts           # detectCommitStyle, buildCommitMessage, commitFeature
│   ├── concurrency.ts      # pLimit (15-line inline promise pool)
│   ├── claude-spawn.ts     # spawnClaudeHeadless
│   ├── prompt-builder.ts   # buildImplementPrompt, buildPlanningPrompt (+ v2: buildSpecGenPrompt, buildDevServerDiscoveryPrompt)
│   ├── verify.ts           # runPreCommit, runFeatureVerify
│   ├── drift-check.ts      # checkScopeDrift
│   ├── run-log.ts          # writeRunSummary, writeAttemptLog, writePlanLog
│   ├── types.ts            # RunSummary, FeatureRunResult, VerifyResult, ExecutionPlan, WorktreeHandle
│   └── ship.test.ts
├── commands/
│   ├── feature-cmd.ts      # runFeatureList, runFeatureNew, ...
│   └── ship-cmd.ts         # runShip (CLI entry)
├── workflows/
│   ├── feature-new.ts      # /reins-feature-new slash command
│   └── ship-here.ts        # /reins-ship-here slash command
├── constraints/
│   └── schema.ts           # extend PipelineConfig
├── state/
│   └── config.ts           # extend ShipConfig (planner_enabled, auto_commit, commit_style, max_parallelism)
└── cli.ts                  # register 'feature' and 'ship' commands
```

New dependencies: **none**. `minimatch` already present, `js-yaml` already present, `node:child_process` is stdlib. `git worktree` uses the system `git` binary via `execSync` (same pattern as `captureKnowledgeFromDiff` in `src/gate/stop.ts`). No concurrency library — `ship/concurrency.ts` ships a 15-line `pLimit` implementation.

## Risks / Trade-offs

- **[Claude Code CLI interface instability]** `-p` mode's exact flag set, output format, and token usage line may change. Mitigate: `claude-spawn.ts` is a single file with a stable internal interface (`ClaudeRunResult`). Any CLI breakage localized there. Add a smoke test `tests/integration/claude-cli-contract.test.ts` that runs `claude -p "echo hello"` and asserts exit 0.

- **[Feature file format churn]** The frontmatter schema is new and will likely evolve. Mitigate: `parseFeatureFile` tolerates unknown fields (doesn't throw). A future migration command (`reins feature migrate`) can bulk-update files if breaking changes happen.

- **[Infinite loop risk]** If `max_attempts` is accidentally set high and Claude Code keeps writing broken code, ship burns tokens without progress. Mitigate: absolute ceiling at runtime (`Math.min(feature.max_attempts ?? config.ship.default_max_attempts, 10)`). Also, `--dry-run` shows planned attempt budget before running.

- **[User loses work if ship is Ctrl+C'd mid-edit]** Claude Code may have partially applied edits. Mitigate: ship runner installs a SIGINT handler that flushes current state (`set-status blocked`, writes partial run log) before exiting. No background git ops — the user's working tree is left as-is, recoverable via `git stash` / `git checkout -- .`.

- **[`git status --porcelain` confused by submodules or newly-created files]** Drift check might produce false positives. Mitigate: drift is warning-only, never blocks. Post-v1 can add submodule-aware detection.

- **[feature_verify commands might need secrets]** E.g. `pytest tests/integration` needs `DATABASE_URL`. Mitigate: ship inherits the parent process env. User exports secrets before running `reins ship`. Documented in tasks.md §11.

- **[Two `reins ship` processes racing]** User accidentally runs two. Mitigate: `.reins/runs/.lock` file with pid; second process exits cleanly with "another ship is running: pid X".

- **[Prompt budget inflation]** Adding constraints + previous failure to each retry inflates tokens. Mitigate: constraints filtered to `critical` + `important` (not `helpful`), failure output tail-limited to 100 lines, feature body size-checked (warn if > 5KB).

- **[Claude Code might refuse to touch certain files]** Hooks in the project (e.g. reins's own `protect-constraints.sh`) could block edits. Ship needs to detect "blocked by hook" vs "broken code" since they need different retry strategies. Mitigate: v1 treats both as "verify failed", v2 parses hook block messages specifically.

- **[Race with user editing features mid-ship]** Handled by mtime snapshot in the runner (§6). Warning, not abort.

- **[Cost transparency insufficient]** Without structured cost output from `claude -p`, token counts are best-effort. Mitigate: document this explicitly in `reins ship --help` so users don't assume accuracy. Fall back to wall-clock timing as a proxy signal.
