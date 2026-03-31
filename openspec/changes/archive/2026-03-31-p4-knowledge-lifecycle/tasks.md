## Tasks

- [ ] **Task 1: Implement staleness.ts**
  - Description: Define `StalenessResult` interface. Implement `checkStaleness(projectRoot, entry)` that iterates `entry.related_files`, runs `git diff --stat <entry.created>..HEAD -- <path>` for each file, parses insertions and deletions against total line count to compute `changeRatio`, applies `confidence -= 20` and `needs_review: true` if any file exceeds 0.3 ratio or is deleted, and applies `confidence -= 10` if `entry.last_injected` is more than 60 days ago. Implement `runStalenessPass(projectRoot)` that loads `index.yaml`, calls `checkStaleness` for each entry, writes back changed entries, then calls `enforceCapacity`.
  - Files: `src/knowledge/staleness.ts`
  - Tests: Unit test `checkStaleness` with a mocked git response showing 40% change ratio applies -20 confidence; test 25% change ratio makes no change; test deleted file applies -20; test `last_injected` older than 60 days applies -10; test both conditions in same entry accumulate correctly; test `runStalenessPass` writes back only entries that changed.
  - Done when: `checkStaleness` and `runStalenessPass` are exported, all decay rules applied correctly, and unit tests pass.

- [ ] **Task 2: Implement feedback.ts**
  - Description: Define `FeedbackRecord` interface. Implement `recordInjectionOutcome(projectRoot, knowledgeId, taskOutcome, relevant)` that loads the entry, applies confidence delta (`+3` for success, `-15` for relevant failure, `0` for irrelevant failure), clamps confidence to `[0, 100]`, increments the appropriate counter in `injection_outcomes`, sets `last_validated` to now, saves the entry, and calls `enforceCapacity`. Implement `resolveRelevance(entry, modifiedFiles)` helper that returns `true` if any of `modifiedFiles` intersects `entry.related_files`.
  - Files: `src/knowledge/feedback.ts`
  - Tests: Unit test success outcome increments `success` counter and adds 3 confidence; test relevant failure decrements by 15 and increments `failure` counter; test irrelevant failure makes no changes; test confidence is clamped at 100 and 0; test `resolveRelevance` returns true on file intersection and false otherwise.
  - Done when: `recordInjectionOutcome` and `resolveRelevance` are exported, asymmetric logic correct, clamp enforced, and unit tests pass.

- [ ] **Task 3: Implement archiver.ts**
  - Description: Define `ArchiveResult` interface. Implement `archiveEntry(projectRoot, knowledgeId)` that reads the entry from `index.yaml`, moves its markdown file to `.reins/knowledge/archive/<file>`, removes it from `index.yaml`, and appends it with `archived_at` timestamp to `.reins/knowledge/archive/index.yaml` (create file if absent). Implement `enforceCapacity(projectRoot)` that runs three passes in order: (1) archive all entries with `confidence < 20`, (2) for each directory prefix compute entry count and archive lowest-confidence excess entries above `max_per_directory`, (3) if total entries exceed `max_global` archive lowest-confidence excess entries.
  - Files: `src/knowledge/archiver.ts`
  - Tests: Unit test `archiveEntry` moves markdown file, removes from active index, appends to archive index with `archived_at`; test `enforceCapacity` archives entries below min_confidence; test per-directory limit evicts lowest-confidence entry when count exceeds max; test global limit evicts lowest-confidence entries until within max; test archive index is created when absent.
  - Done when: `archiveEntry` and `enforceCapacity` are exported, all three capacity passes run in order, archive index maintained correctly, and unit tests pass.

- [ ] **Task 4: Wire staleness and feedback into session lifecycle**
  - Description: In the session-start hook script (`.reins/hooks/knowledge-inject.sh` or equivalent from p3), add a call to `runStalenessPass` before injection. In the Stop hook result handler (`src/hooks/health-monitor.ts` or Stop hook script), after the task outcome is known: read the session's injected knowledge IDs from the session state file, call `recordInjectionOutcome` for each with `resolveRelevance` to determine the `relevant` flag. In `src/cli.ts` `reins update` command, call `runStalenessPass` and `enforceCapacity` and print a summary of archived/updated entries.
  - Files: `src/knowledge/staleness.ts`, `src/knowledge/feedback.ts`, `src/knowledge/archiver.ts`, `src/cli.ts`
  - Tests: Integration test that `reins update` on a repo with a stale knowledge entry (related file changed >30%) reduces its confidence and marks it `needs_review`; test that an entry at confidence 18 after staleness pass is moved to archive.
  - Done when: Staleness pass runs on session start and `reins update`; feedback recording runs on Stop; archiver enforces invariants after each mutation; integration tests pass.
