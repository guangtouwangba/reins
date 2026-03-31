## Approach

All three mechanisms operate on the same `index.yaml` data model established in Phase 3. Staleness and feedback mutate `confidence` and metadata fields; the archiver enforces invariants after each mutation. No new storage format is introduced—archive is a second `index.yaml` under `archive/` using the same schema. The mechanisms are designed to be independently testable and independently runnable; none requires the others to have run first.

## Architecture

**Staleness** (`src/knowledge/staleness.ts`)

```typescript
interface StalenessResult {
  knowledgeId: string;
  wasStale: boolean;
  confidenceDelta: number;
  reason: string;
}

async function checkStaleness(
  projectRoot: string,
  entry: KnowledgeEntry
): Promise<StalenessResult>

async function runStalenessPass(projectRoot: string): Promise<StalenessResult[]>
```

`checkStaleness` for a single entry:
1. For each path in `entry.related_files`, run `git diff --stat <entry.created>..HEAD -- <path>` and parse the insertion/deletion counts against total line count to compute `changeRatio`.
2. If any file is absent (git says deleted) → `confidence -= 20`, `needs_review: true`, reason `"file deleted"`.
3. If any file has `changeRatio > 0.3` → `confidence -= 20`, `needs_review: true`, reason includes file path and ratio.
4. If `entry.last_injected` is more than 60 days before today → `confidence -= 10`, reason `"unused 60+ days"`.
5. Changes are accumulated (a single entry can lose up to 30 confidence in one pass if both stale-file and unused-decay apply).

`runStalenessPass` iterates over all entries in `index.yaml`, calls `checkStaleness`, writes back any entries that changed, then calls archiver.

**Feedback** (`src/knowledge/feedback.ts`)

```typescript
interface FeedbackRecord {
  knowledgeId: string;
  taskOutcome: 'success' | 'failure';
  relevant: boolean;
  timestamp: string;
}

function recordInjectionOutcome(
  projectRoot: string,
  knowledgeId: string,
  taskOutcome: 'success' | 'failure',
  relevant: boolean
): void
```

Logic:
- `success`: `entry.confidence = min(100, entry.confidence + 3)`, `entry.injection_outcomes.success++`
- `failure && relevant`: `entry.confidence = max(0, entry.confidence - 15)`, `entry.injection_outcomes.failure++`
- `failure && !relevant`: no confidence change, no counter update
- Always: `entry.last_validated = now()`
- After write: call archiver to enforce capacity and min-confidence.

The `relevant` flag is set by the caller (Stop hook result handler) using a heuristic: relevant if the failed task touched any file in `entry.related_files`.

**Archiver** (`src/knowledge/archiver.ts`)

```typescript
interface ArchiveResult {
  archived: string[];    // knowledge IDs moved to archive
  evicted: string[];     // knowledge IDs evicted to make room
}

function enforceCapacity(projectRoot: string): ArchiveResult
function archiveEntry(projectRoot: string, knowledgeId: string): void
```

`enforceCapacity` runs three passes in order:
1. **Min-confidence sweep**: Find all entries with `confidence < 20`; call `archiveEntry` for each.
2. **Per-directory limit**: For each directory, collect entries whose `related_files` are all under that directory; if count > `max_per_directory`, sort by confidence ascending and archive the excess.
3. **Global limit**: If total active entries > `max_global`, sort all entries by confidence ascending and archive until within limit.

`archiveEntry`:
1. Move the markdown file from `.reins/knowledge/<file>` to `.reins/knowledge/archive/<file>`.
2. Remove the entry from `.reins/knowledge/index.yaml`.
3. Append the entry to `.reins/knowledge/archive/index.yaml` (create if absent), adding `archived_at` timestamp.

**Integration wiring**:

- `staleness.ts` → called by `runStalenessPass` from session-start hook and `reins update`
- `feedback.ts` → called by Stop hook result handler after reading which knowledge IDs were injected in this session (tracked in session state file)
- `archiver.ts` → called internally by staleness and feedback after any confidence mutation; also callable directly by `reins update`

**Data flow for session lifecycle**:
```
Session start
  → runStalenessPass()           // lightweight: only checks last_injected + git diff
  → inject relevant entries      // retriever updates last_injected

Session end (Stop hook)
  → for each injected entry:
      recordInjectionOutcome(id, outcome, relevant)
  → enforceCapacity()            // called inside recordInjectionOutcome
```

**Data flow for `reins update`**:
```
reins update
  → runStalenessPass()           // full pass over all entries
  → enforceCapacity()            // final sweep
  → report summary to user
```

## Key Decisions

- **git diff for change ratio, not file mtime**: mtime is unreliable (checkout, build tools touch files). Git diff gives accurate insertion/deletion counts against the date when the knowledge was created. Requires git but the project is already assumed to be a git repository.
- **Asymmetric feedback constants are hardcoded, not configurable in this phase**: The module doc specifies +3/−15. Making them configurable adds complexity without evidence that projects need different values. Can be promoted to `config.yaml` in Phase 5 if needed.
- **Archive does not delete, just moves**: Knowledge entries below the confidence threshold may still have investigative value. Moving to `archive/` preserves them for human review without cluttering the active injection pool. The archive is gitignored so it does not pollute team shared knowledge.
- **Per-directory limit uses `related_files` heuristic, not actual file location**: An entry's "directory" is the common prefix of its `related_files`. If an entry has files in multiple directories it counts toward all of them. This is a simple approximation that handles the common case correctly.
- **Archiver runs after every confidence mutation, not batched**: Running after each mutation ensures invariants are always maintained and prevents a batch of mutations from temporarily violating limits. The cost is negligible—`index.yaml` is at most 100 entries.

## File Structure

```
src/knowledge/staleness.ts    # checkStaleness(), runStalenessPass(), unused decay
src/knowledge/feedback.ts     # recordInjectionOutcome(), asymmetric confidence update
src/knowledge/archiver.ts     # enforceCapacity(), archiveEntry()
```
