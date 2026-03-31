## Approach

Each command is a self-contained module in `src/commands/`. The CLI entry point (`src/cli.ts`) registers them with Commander.js. Commands are thin orchestrators: they call into existing state, constraint, and hook modules rather than reimplementing logic. LLM calls (hook generation, hook fix) go through the existing inference utility used by other commands.

## Architecture

**`reins status`** (`src/commands/status.ts`)

```typescript
interface StatusReport {
  generatedAt: string;
  constraints: ConstraintStatus[];
  summary: { critical: number; important: number; helpful: number; violations_7d: number };
  suggestions: string[];
}

interface ConstraintStatus {
  id: string;
  rule: string;
  severity: Severity;
  violations: { count: number; trend: 'up' | 'down' | 'stable' }; // from logs
  hookStatus: 'active' | 'disabled' | 'none';
  lastTriggered: string | null;
}

async function runStatus(options: { filter?: string; format?: string; since?: string }): Promise<void>
```

- Reads `constraints.yaml` to get all constraints
- Reads `.reins/logs/*.jsonl` filtering by `--since` duration
- Aggregates violation counts per constraint id
- Computes trend by comparing first-half vs second-half of the time window
- Suggestions: constraints with zero violations for >30d → suggest relaxing; constraints with >10 violations/day → suggest hook upgrade
- Output routed through a formatter (human/json/markdown) before printing

**`reins update`** (`src/commands/update.ts`)

```typescript
async function runUpdate(options: { autoApply?: boolean }): Promise<void>
```

Data flow:
```
loadManifest(prev) → buildManifest(curr) → diffManifest(prev, curr)
  → [if !hasChanges] exit "nothing changed"
  → rescan changed paths only (call scanner with path filter)
  → inferConstraints(changedContext)
  → mergeConstraints(existing, new) → MergeResult
  → [autoApply] apply added where confidence >= 90, else present interactive diff
  → saveSnapshot("update") → writeConstraintsYaml → saveManifest(curr)
```

**`reins test`** (`src/commands/test.ts`)

```typescript
interface HookTestResult {
  hookId: string;
  hookPath: string;
  syntheticPass: 'ok' | 'unexpected-block' | 'error';
  syntheticFail: 'ok' | 'unexpected-allow' | 'error';
  verdict: 'healthy' | 'broken' | 'disabled';
}

async function runTest(): Promise<void>
```

- Reads all hook scripts from `.reins/hooks/`
- For each hook: constructs a synthetic "passing" input (file that satisfies the hook's check) and a synthetic "failing" input (file that violates it)
- Executes hook with each input, checks exit code against expected
- Reports results in a table; exits non-zero if any hook is `broken`

**`reins rollback`** (`src/commands/rollback.ts`)

```typescript
async function runRollback(options: { to?: string }): Promise<void>
```

- Without `--to`: calls `listSnapshots()`, prints a numbered list, prompts user to select
- With `--to <id>`: validates id exists
- In both cases: calls `saveSnapshot("pre-rollback")` first, then `restoreSnapshot(id)`
- Prints which files were restored

**`reins hook`** (`src/commands/hook.ts`)

Sub-commands:

| Sub-command | Behavior |
|-------------|----------|
| `hook add <description>` | LLM generates bash hook from description → writes to `.reins/hooks/<id>.sh` → adds entry to `constraints.yaml` enforcement section → `saveSnapshot("hook-add")` |
| `hook list` | Reads hooks dir + constraints.yaml, prints table: id, type, mode, status, last-triggered |
| `hook disable <id>` | Sets `hook_mode: off` in `constraints.yaml` for that constraint |
| `hook fix` | Runs same health check as `reins test` for broken hooks; for each broken hook, sends hook script + error context to LLM for repair suggestion; writes fix if user approves |
| `hook promote <constraint-id>` | Finds soft constraint, prompts for hook type, generates hook script via LLM, sets `hook: true` in constraints.yaml |

## Key Decisions

- **Commands are thin orchestrators**: `status` doesn't parse logs itself — it calls a `LogReader` utility. `update` doesn't merge constraints itself — it calls `mergeConstraints` from `constraints/merger.ts`. This keeps commands testable without re-implementing logic.
- **`reins test` uses synthetic inputs, not real project files**: Real files may or may not satisfy a hook's condition. Synthetic inputs are constructed from the hook's `hook_check` pattern, making tests deterministic.
- **`--auto-apply` is opt-in and confidence-gated**: Automatic constraint changes without user review caused churn in early testing. The 90% confidence threshold means only changes the scanner is highly certain about are auto-applied.
- **`hook fix` requires user approval**: LLM-generated fixes for broken hooks are not automatically applied. The user must confirm each fix to avoid silent behavior changes.
- **Rollback saves a pre-rollback snapshot**: This gives users an escape hatch if the rollback itself is wrong ("I rolled back to the wrong snapshot").

## File Structure

```
src/commands/status.ts        # reins status implementation
src/commands/update.ts        # reins update implementation
src/commands/test.ts          # reins test implementation
src/commands/rollback.ts      # reins rollback implementation
src/commands/hook.ts          # reins hook sub-commands
src/cli.ts                    # register new commands (modified)
```
