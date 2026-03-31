## Approach

Extend the existing `knowledge/promoter.ts` stub to implement the full promotion evaluation loop, and add a new `lifecycle/consistency.ts` module for session-end staleness maintenance. Both modules are triggered by the `SessionEnd` hook — promotion evaluation runs after the session's new knowledge is captured, consistency check runs against files modified during the session. All promotion actions require user confirmation before writing to `constraints.yaml` or `AGENTS.md`; the system surfaces candidates, it does not auto-write.

## Architecture

**Promotion evaluator** (`knowledge/promoter.ts`):
- Exports `evaluatePromotions(entries: KnowledgeEntry[]): PromotionCandidate[]`
- For each entry, calls `checkPromotion(entry)`:
  - Guard 1: `entry.confidence < 90` → return null
  - Guard 2: `entry.injection_outcomes.success < 5` → return null
  - Guard 3: `success / (success + failure) < 0.8` → return null
  - Type routing:
    - `preference` | `coupling` → `targetType: 'constraint'`
    - `gotcha` → `targetType: 'skill'`
    - `decision` → `targetType: 'l1_addition'`
  - Returns `PromotionCandidate { knowledge, targetType, reason }`
- `reason` string includes validation count and success rate for user-facing display
- If `promotion.auto_suggest: true` (config default), emits candidates to stdout as a structured prompt at session end
- Does not write anything; writing is gated behind user confirmation via `reins promote <knowledge-id>`

**`reins promote <id>` CLI command** (new, `src/cli.ts`):
- Loads the knowledge entry by id
- Re-runs `checkPromotion()` to confirm conditions still met
- For `targetType: 'constraint'`: calls `ConstraintWriter.appendRule(entry)`, triggers recompile
- For `targetType: 'skill'`: calls `writeSkill(entry)` to `.reins/skills/`
- For `targetType: 'l1_addition'`: appends a new section to the appropriate directory `AGENTS.md`
- Marks the knowledge entry with `promoted: true` and `promoted_at` timestamp in `index.yaml`

**Reverse demotion detector** (`knowledge/promoter.ts`):
- Exports `checkDemotion(rule: string, bypassLog: BypassEvent[]): DemotionSuggestion | null`
- `BypassEvent`: `{ rule, timestamp, outcome: 'success' | 'failure' }`
- Conditions: `bypassLog.length > 5` AND `successAfterBypass / total > 0.9`
- Returns `DemotionSuggestion { rule, bypassCount, successRate, suggestion: 'downgrade_to_preference' }`
- Bypass events are recorded by the existing constraint violation tracker in `observer.ts` (from `p5-self-improving`)

**Session consistency checker** (`lifecycle/consistency.ts`):
- Exports `runConsistencyCheck(sessionFiles: string[], knowledgeIndex: KnowledgeIndex): ConsistencyReport`
- For each file modified in the current session:
  - Find all `KnowledgeEntry` records where `related_files` includes or shares a directory with the modified file
  - For each matching entry:
    - Reduce `confidence` by a configurable amount (default: -10)
    - Set `needs_review: true`
    - Record in the consistency report
- Writes updated entries back to `index.yaml`
- Returns `ConsistencyReport { reviewed: number, staleMarked: number, entries: string[] }`

**Injection freshness warning** (`knowledge/injector.ts`):
- Extended: before formatting each entry for injection, call `checkFileFreshness(entry)`
- `checkFileFreshness`: for each `related_file`, compare `entry.created` date to file `mtime`; if mtime is newer and `changeRatio > stale_file_change_ratio` (config default: 0.3), set `isFresh: false`
- Non-fresh entries are injected with a prepended warning line:
  ```
  [Reins Knowledge] ⚠ Created <N> days ago; <file> modified since — verify before adopting.
  ```
- Injection metadata annotates each entry with `source_task` and `created` for agent self-assessment

**SessionEnd hook wiring**:
- After `p5-self-improving`'s `reins learn --auto`, hook also calls `reins knowledge --check-promotions` and `reins knowledge --consistency`
- Both are new CLI subcommands that wrap the respective module exports

## Key Decisions

- **User confirmation required for all promotions**: Automated promotion writes to `constraints.yaml` or `AGENTS.md` without review would undermine team trust in the system. The promotion evaluator only surfaces candidates; a deliberate `reins promote <id>` is required to execute. This is consistent with module ⑧'s "human in the loop" principle for high-impact decisions.
- **Consistency check lowers confidence, does not delete**: Modified files invalidate assumptions, but do not guarantee the knowledge is wrong. Lowering confidence and flagging `needs_review` keeps the knowledge available with a visible warning rather than silently deleting potentially still-valid entries.
- **Demotion suggestion, not automatic demotion**: Downgrading a formal constraint back to a preference is a team decision. The system records the signal; the team acts on it.
- **`lifecycle/` as a new subdirectory**: Consistency checking is distinct from knowledge storage, retrieval, and promotion. Placing it in `src/lifecycle/` keeps the concern boundary clear and avoids growing `src/knowledge/` into a catch-all.
- **`reins promote <id>` as a CLI command**: Making promotion an explicit CLI action gives it a clear entry point for documentation, testing, and future automation hooks.

## File Structure

```
src/knowledge/
├── promoter.ts                     # enhanced: checkPromotion(), PromotionCandidate, demotion detection
├── injector.ts                     # extended: freshness warning, source annotation

src/lifecycle/
└── consistency.ts                  # new: session-end consistency check, confidence decay on modified files

src/cli.ts                          # extended: reins promote <id>, reins knowledge --check-promotions, reins knowledge --consistency

.reins/
├── knowledge/
│   └── index.yaml                  # extended: promoted, promoted_at, needs_review fields per entry
└── logs/
    └── promotion-log.yaml          # append-only record of all promotion and demotion suggestions
```
