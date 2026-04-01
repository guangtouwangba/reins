## Why

Reins is moving from design to real-world usage. When things go wrong — a hook blocks unexpectedly, a pipeline fails after 20 minutes, a command resolves to the wrong value — the current logging tells you *what* failed but not *why*. The execution log says `stage: ralph, success: false`; the hook health says `consecutiveErrors: 3`. Neither tells you which constraint was violated, what the hook's input was, which layer of command resolution gave the wrong answer, or what the executor actually generated before the review rejected it.

Three specific gaps block fast iteration:

1. **No operation-level tracing**: Execution logs capture stage-level pass/fail. But each stage contains dozens of decisions (which constraints matched? which hook fired? which command layer won?). Without operation-level traces, debugging requires re-running the entire pipeline with print statements.

2. **No error-to-root-cause linkage**: Errors are scattered across execution logs, hook health, evaluation results, and weekly reports. There's no single view that says "this pipeline failed because this constraint was violated 3 times because the executor doesn't understand the Prisma rule because the constraint injection prompt was too vague."

3. **No decision audit trail**: The 7-layer command resolution, 3-layer question engine, spec generation, and constraint injection all make decisions that compound. When the final output is wrong, you can't trace back through the decision chain to find which layer introduced the error.

The existing logging infrastructure (execution records, hook health monitor, weekly analysis) is solid for post-hoc learning. What's missing is **in-flight decision tracing** for fast debugging during the critical early adoption phase.

## What Changes

### 1. Operation-Level Tracer (`src/diagnostics/tracer.ts`)

A lightweight, zero-dependency tracing system that records every decision point as a JSONL line. Each execution gets a trace directory containing per-module trace files:

```
.reins/logs/traces/<execution-id>/
├── scan.jsonl          # Scanner decisions: stack detection, workspace discovery, command resolution (all 7 layers)
├── commands.jsonl      # Command resolution detail: each layer's input/output/reason
├── spec.jsonl          # Requirement refinement: inferred facts, questions asked, user answers, spec generation
├── hooks.jsonl         # Every hook invocation: input (file/content), script, exit code, stdout, stderr, duration
├── execution.jsonl     # Executor per-task: which files created/modified, tool calls, errors encountered
├── review.jsonl        # Ralph each iteration: constraints checked, violations found, spec coverage, fix actions
└── qa.jsonl            # QA each command: command string, exit code, stdout/stderr, duration
```

**Trace entry format (JSONL — one line per operation):**

```jsonl
{"ts":"2026-04-01T10:30:01.123Z","op":"scan.resolveCommands.layer4","layer":"scripts","result":{"build":"pnpm build"},"reason":"parsed package.json scripts","durationMs":5}
{"ts":"2026-04-01T10:30:01.128Z","op":"scan.resolveCommands.layer6","layer":"skill","result":{"lint":"myco lint --strict"},"reason":"matched skill: mycompany-toolchain (signal: myco.config.yaml)","durationMs":8}
```

**Implementation**: A `Tracer` class with a single `trace(op, data)` method that appends a JSON line to a file stream. No log levels, no formatting — just timestamped structured data. Each module gets its own `Tracer` instance writing to its own `.jsonl` file. Tracer is always on by default (files are small — typically 5-50KB per execution). Can be disabled via `config.yaml` `diagnostics.trace: false`.

### 2. Hook Invocation Logging (enhanced `hooks.jsonl`)

Every hook invocation records full context — not just pass/fail, but the exact input, script, and output:

```jsonl
{"ts":"...","op":"hook.postEdit","hookId":"no-direct-sql","trigger":"Edit","input":{"file":"app/api/avatar/route.ts","contentSnippet":"...first 500 chars..."},"script":".reins/hooks/post-edit-check.sh","exitCode":2,"stdout":"","stderr":"⛔ Reins: Constraint violated: no-direct-sql\nMatched: SELECT * FROM users","durationMs":38}
```

This captures: which file triggered the hook, what the hook script was, exit code, and the exact error message. Currently `hook-health.yaml` only tracks consecutive error counts — the new trace provides the *content* of each invocation for debugging.

### 3. Command Resolution Audit Trail (`commands.jsonl`)

The 7-layer command resolution produces a detailed trace showing what each layer contributed:

```jsonl
{"ts":"...","op":"commands.layer1","layer":"convention","result":{},"reason":"no Go/Rust/Python detected, JS conventions not applicable (no package.json scripts matched)"}
{"ts":"...","op":"commands.layer3","layer":"docs","result":{"test":"dx test"},"reason":"extracted from README.md: heading 'Testing' → code block 'dx test'","confidence":0.7}
{"ts":"...","op":"commands.layer4","layer":"scripts","result":{"build":"pnpm build","typecheck":"pnpm tsc"},"reason":"package.json scripts: build, typecheck"}
{"ts":"...","op":"commands.layer6","layer":"skill","matched":"mycompany-toolchain","signals":["myco.config.yaml"],"result":{"lint":"myco lint --strict","lintFix":"myco lint --strict --fix"},"reason":"signal file myco.config.yaml exists"}
{"ts":"...","op":"commands.layer7","layer":"user","result":{},"reason":"no .reins/commands.yaml found"}
{"ts":"...","op":"commands.final","result":{"build":{"command":"pnpm build","source":"script","confidence":1.0},"lint":{"command":"myco lint --strict","source":"skill","confidence":1.0},"test":{"command":"dx test","source":"docs","confidence":0.7}}}
```

When a command is wrong, you grep `commands.jsonl` and immediately see which layer gave the answer and why.

### 4. Review Iteration Trail (`review.jsonl`)

Each RALPH iteration records what was checked, what failed, and what was fixed:

```jsonl
{"ts":"...","op":"review.iteration","iteration":1,"constraintResults":{"passed":11,"failed":1,"failedList":["no-direct-sql"]},"specCoverage":{"total":6,"covered":5,"uncovered":["All new files have tests"]},"action":"fix"}
{"ts":"...","op":"review.fix","iteration":1,"fixes":[{"type":"constraint-violation","constraint":"no-direct-sql","file":"app/api/avatar/route.ts","action":"replaced raw SQL with prisma call"},{"type":"uncovered-criterion","criterion":"All new files have tests","action":"created AvatarUploader.test.tsx"}]}
{"ts":"...","op":"review.iteration","iteration":2,"constraintResults":{"passed":12,"failed":0},"specCoverage":{"total":6,"covered":6,"uncovered":[]},"action":"exit"}
```

### 5. Error Index (`src/diagnostics/error-index.ts`)

A unified error collector that aggregates errors from all sources into a single searchable index:

```
.reins/logs/errors/index.jsonl
```

```jsonl
{"ts":"...","executionId":"2026-04-01-001","source":"hook","hookId":"no-direct-sql","file":"app/api/avatar/route.ts","error":"Matched: SELECT * FROM users","category":"constraint-violation","rootCause":"executor-generated-raw-sql","occurrences":3}
{"ts":"...","executionId":"2026-04-01-001","source":"qa","command":"myco lint --strict","exitCode":1,"error":"Unused import: sharp","category":"lint-error","rootCause":"dead-import","occurrences":1}
```

Error entries include:
- `source`: where the error originated (hook, qa, review, execution)
- `category`: classified error type (constraint-violation, lint-error, type-error, test-failure, runtime-error)
- `rootCause`: inferred root cause (populated by pattern matching against known error patterns)
- `occurrences`: how many times this exact error appeared (across iterations and executions)

The error index enables deduplication (same error appearing 3 times in ralph iterations is one entry with `occurrences: 3`) and cross-execution pattern detection (same error in multiple executions → suggest a new constraint or skill).

### 6. `reins diagnose` Command (`src/commands/diagnose.ts`)

A diagnostic command that reads traces and produces a human-readable summary:

```
$ reins diagnose [execution-id]
```

Without an ID, diagnoses the most recent execution. Output:

```
Last execution: 2026-04-01-001 (8m 30s, success)

Scan:
  ✓ 7 commands resolved
    scripts: build, typecheck  |  skill: lint, lintFix, test, testSingle  |  convention: install
  ✓ 2 workspace packages (packages/web, packages/api)

Spec:
  ✓ 3 questions asked, 5 facts inferred from context
  ✓ spec.md confirmed (6 acceptance criteria)

Hooks (23 invocations):
  ✓ 21 passed
  ✗ 2 blocked → no-direct-sql on app/api/avatar/route.ts (auto-fixed in review)

Review (2 iterations):
  Iteration 1: 11/12 constraints ✓, 5/6 spec criteria ✓
    ✗ no-direct-sql: raw SQL in route.ts → fixed: replaced with prisma call
    ✗ missing test: AvatarUploader.tsx → fixed: created test file
  Iteration 2: 12/12 ✓, 6/6 ✓

QA:
  ✓ myco lint --strict (3.2s)
  ✓ pnpm tsc (5.1s)
  ✓ dx test (12.4s, 55/55 passed)
```

On failure, adds root cause analysis:

```
$ reins diagnose

Last execution: 2026-04-01-002 (20m 15s, FAILED at ralph)

⚠ Root cause:
  Constraint "no-direct-sql" violated 3 times across 3 ralph iterations.
  Executor repeatedly generated raw SQL despite Prisma constraint.

  Evidence (from review.jsonl):
    Iteration 1: SELECT * FROM users WHERE id = ?  (route.ts:15)
    Iteration 2: UPDATE users SET avatar = ?        (route.ts:23)
    Iteration 3: DELETE FROM avatars WHERE user_id = ? (route.ts:31)

  This error has occurred 2 times in the last 7 days (from error index).

  Suggested actions:
    1. Add a code example to .reins/patterns/prisma-usage.md showing the correct pattern
    2. Check constraint injection prompt clarity (trace: scan.jsonl → constraint text)
    3. Consider promoting this to a hook with stricter grep pattern
```

### 7. `--debug` Flag for Verbose Output

`reins develop --debug` enables real-time trace output to stderr while executing:

```
$ reins develop "avatar upload" --debug

[10:30:01] scan.detectStack: language=[typescript], framework=[next.js]
[10:30:01] scan.resolveCommands.layer4: scripts → build=pnpm build, typecheck=pnpm tsc
[10:30:01] scan.resolveCommands.layer6: skill:mycompany-toolchain → lint=myco lint --strict
[10:30:01] scan.resolveCommands.final: 7/12 commands resolved
...
[10:31:00] hook.postEdit: no-direct-sql on avatar.ts → exit 0 ✓
[10:31:30] hook.postEdit: no-direct-sql on route.ts → exit 2 ✗ (matched: SELECT * FROM)
...
```

Same trace data, just also printed to terminal in real time. Useful for watching the pipeline as it runs.

## Capabilities

### New Capabilities

- `operation-tracer`: JSONL-based operation-level tracing for all modules (scan, commands, spec, hooks, execution, review, qa) with timestamped structured entries. Always on by default, ~5-50KB per execution.
- `hook-invocation-log`: Full context capture for every hook invocation — input file/content, script path, exit code, stdout, stderr, duration. Replaces guesswork with exact reproduction data.
- `command-resolution-audit`: Per-layer trace of the 7-layer command resolution showing what each layer contributed and why, enabling instant diagnosis of wrong command resolution.
- `review-iteration-trail`: Per-iteration trace of RALPH review showing constraint results, spec coverage, and fix actions taken. Shows exactly why the review loop kept iterating.
- `error-index`: Unified error collector with classification, root cause inference, deduplication, and cross-execution pattern detection. Single source of truth for all errors.
- `diagnose-command`: `reins diagnose [execution-id]` reads traces and produces a human-readable summary with root cause analysis and suggested actions for failures.
- `debug-flag`: `--debug` flag for real-time trace output to stderr during execution.

### Modified Capabilities

- `pipeline-runner`: Each stage creates a `Tracer` instance and traces its key decision points. Trace directory linked to execution ID.
- `hook-system`: Hook runner calls `tracer.trace()` with full invocation context (input, script, output, exit code) in addition to existing health monitoring.
- `command-resolver`: Each of the 7 layers traces its result and reasoning.
- `scan-entry`: Scanner traces workspace detection, stack detection, and pattern analysis decisions.
- `constraint-injector`: Traces the final injected prompt content (truncated) for debugging injection issues.
- `review-loop`: Traces each iteration's constraint check results and spec coverage.
- `qa-runner`: Traces each command execution with exit code, stdout, stderr.
- `execution-logger`: Execution record gains a `traceDir` field pointing to the trace directory for this execution.
- `reins-status`: Can optionally show recent error patterns from the error index.

## Impact

- New directory `.reins/logs/traces/` created per execution. Average size 5-50KB per execution. With default retention (30 days), a daily-use project accumulates ~1-2MB of traces per month.
- `Tracer` class is injected into modules via a factory function — modules call `tracer.trace()` at decision points. This adds ~1 line of code per decision point. No logic changes, no control flow changes.
- Trace files are `.gitignored` (personal debugging data, not team-shared). Error index is also `.gitignored`.
- `--debug` flag adds a second write target (stderr) to the tracer. No performance impact when not used. When used, adds terminal I/O overhead proportional to trace volume.
- New CLI command `reins diagnose` — read-only, no side effects, safe to run anytime.
- No new external dependencies. Uses Node.js `fs.createWriteStream` for append-only JSONL writes.
- Hook invocation logging captures file content snippets (first 500 chars). This may include sensitive data — the trace files should not be committed to git (already covered by `.gitignore` placement).
- Error index pattern matching uses simple string comparison against known error patterns — no ML, no external services. Pattern database grows as the self-improving system (module ⑧) identifies recurring errors.
- Log retention: traces older than 30 days are auto-deleted by `reins update`. Configurable via `diagnostics.retention_days` in `config.yaml`.
