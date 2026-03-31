## Why

Without decay, a knowledge system accumulates stale entries that mislead future tasks—a refactored file still triggering old coupling warnings, a fixed gotcha still being injected as a caution. Phase 3 built capture and retrieval; Phase 4 adds the mechanisms that keep the knowledge base accurate over time: file-change staleness detection, injection outcome feedback, and hard capacity limits with automatic archiving.

## What Changes

- Add `src/knowledge/staleness.ts` implementing file-change staleness detection: when a `related_file` has changed more than 30% since the knowledge entry was created, reduce `confidence` by 20 and mark `needs_review: true`
- Add `src/knowledge/feedback.ts` implementing asymmetric injection outcome recording: task success → `confidence += 3`, relevant failure → `confidence -= 15`; update `injection_outcomes` counters and `last_validated` timestamp
- Add `src/knowledge/archiver.ts` implementing capacity enforcement: when `max_per_directory` (default 10) or `max_global` (default 100) is exceeded, evict the entry with the lowest confidence; automatically archive any entry whose confidence drops below `min_confidence` (default 20) by moving the markdown file and index entry to `.reins/knowledge/archive/`
- Add unused-entry decay to `src/knowledge/staleness.ts`: entries not retrieved in more than 60 days receive `confidence -= 10`
- Wire staleness check into session start (lightweight scan) and `reins update`; wire feedback recording into the Stop hook result handler; wire archiver into every confidence-mutating operation

## Capabilities

### New Capabilities

- `knowledge-staleness`: On session start or `reins update`, scans `index.yaml` entries, computes file change ratios for `related_files` using git diff stats, applies `confidence -= 20` and `needs_review: true` for entries where any related file changed more than 30%; applies `confidence -= 10` for entries not retrieved in over 60 days
- `injection-feedback`: Records task outcome against each injected knowledge entry; `success` adds 3 confidence, `relevant_failure` subtracts 15; updates `injection_outcomes.success`/`failure` counters and `last_validated`; no penalty for injections where the failure is unrelated to the knowledge entry
- `knowledge-archiver`: After every confidence mutation, checks global count and per-directory count against limits; evicts lowest-confidence entries until within limits; moves any entry with `confidence < 20` to `.reins/knowledge/archive/` (removes from `index.yaml`, writes to `archive/index.yaml`)

### Modified Capabilities

- `knowledge-store` (`src/knowledge/store.ts`): All write operations now call the archiver after saving; read operations now update `last_injected` timestamp for decay tracking
- `knowledge-retriever` (`src/knowledge/retriever.ts`): Updates `last_injected` on each retrieved entry to reset the unused-decay clock

## Impact

- New source files: `src/knowledge/staleness.ts`, `src/knowledge/feedback.ts`, `src/knowledge/archiver.ts`
- Modified source files: `src/knowledge/store.ts`, `src/knowledge/retriever.ts`
- `index.yaml` schema extended with `needs_review: boolean`, `last_injected: string` (already present per module doc), and `archive/index.yaml` for archived entries
- `.reins/knowledge/archive/` directory is gitignored; active knowledge entries remain committed
- Depends on `p3-knowledge-capture` (store.ts, index.yaml format) and `p3-knowledge-retrieval` (retriever.ts, injection tracking)
- Git integration: staleness check uses `git diff --stat` between entry `created` date and HEAD; requires git to be available at runtime
