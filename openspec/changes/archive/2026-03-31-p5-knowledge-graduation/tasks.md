## Tasks

- [ ] **Task 1: Implement `checkPromotion()` in `knowledge/promoter.ts`**
  - Description: Replace the stub in `src/knowledge/promoter.ts` with a full implementation. Define and export `PromotionCandidate` interface: `{ knowledge: KnowledgeEntry, targetType: 'constraint' | 'skill' | 'l1_addition', reason: string }`. Implement `checkPromotion(entry: KnowledgeEntry): PromotionCandidate | null` with the three guards: `confidence < 90` → null, `injection_outcomes.success < 5` → null, `success / total < 0.8` → null. Route by type: `preference`/`coupling` → `'constraint'`, `gotcha` → `'skill'`, `decision` → `'l1_addition'`. Build `reason` string as `"Validated <N> times, <P>% success rate"`. Export `evaluatePromotions(entries: KnowledgeEntry[]): PromotionCandidate[]` that maps entries through `checkPromotion` and filters nulls.
  - Files: `src/knowledge/promoter.ts`
  - Tests: Unit test each type routing; unit test each guard condition at boundary (confidence = 89 → null, confidence = 90 + other conditions met → candidate); unit test that success rate of exactly 0.8 passes; unit test that 0.79 fails
  - Done when: All three guards correct; all four type routes correct; boundary tests pass; `tsc --noEmit` 0 errors

- [ ] **Task 2: Implement demotion detection in `knowledge/promoter.ts`**
  - Description: Add `BypassEvent` interface: `{ rule: string, timestamp: string, outcome: 'success' | 'failure' }`. Add `DemotionSuggestion` interface: `{ rule: string, bypassCount: number, successRate: number, suggestion: 'downgrade_to_preference' }`. Export `checkDemotion(rule: string, bypassLog: BypassEvent[]): DemotionSuggestion | null`. Conditions: `bypassLog.length > 5` AND `(successful bypasses / total) > 0.9`. Return null if conditions not met.
  - Files: `src/knowledge/promoter.ts`
  - Tests: Unit test with 6 bypass events all successful → returns suggestion; unit test with 6 bypasses but only 80% success → returns null; unit test with exactly 5 events (not > 5) → returns null
  - Done when: Both conditions evaluated correctly; boundary at exactly 5 returns null; `tsc --noEmit` 0 errors

- [ ] **Task 3: Add `reins promote <id>` CLI command**
  - Description: Add `promote` subcommand to `src/cli.ts` accepting a knowledge `<id>` argument. Command flow: load `index.yaml`, find entry by id, re-run `checkPromotion()` (confirm conditions still met), dispatch by `targetType`: for `'constraint'` call the constraint writer to append the rule and trigger recompile; for `'skill'` call `writeSkill()` to `.reins/skills/`; for `'l1_addition'` append a section to the appropriate `AGENTS.md`. Mark the entry in `index.yaml` with `promoted: true` and `promoted_at: <ISO timestamp>`. Append to `.reins/logs/promotion-log.yaml`.
  - Files: `src/cli.ts`, `src/knowledge/promoter.ts`
  - Tests: Integration test promoting a fixture `gotcha` entry — verify skill file is created at `.reins/skills/<name>.yaml` and `index.yaml` has `promoted: true`; test that promoting an entry that no longer meets conditions exits with an informative error
  - Done when: All three target types handled; `index.yaml` updated; promotion log appended; conditions re-checked at execution time

- [ ] **Task 4: Create `lifecycle/consistency.ts`**
  - Description: Create `src/lifecycle/consistency.ts`. Define `ConsistencyReport` interface: `{ reviewed: number, staleMarked: number, entries: string[] }`. Export `runConsistencyCheck(sessionFiles: string[], knowledgeIndex: KnowledgeIndex, projectRoot: string): ConsistencyReport`. For each modified file: find entries in `knowledgeIndex` where `related_files` contains the file or shares a directory prefix. For each matching entry: subtract 10 from `confidence` (floor 0), set `needs_review: true`. Write updated entries back to `index.yaml`. Return the report.
  - Files: `src/lifecycle/consistency.ts`
  - Tests: Unit test with 3 knowledge entries and 1 session-modified file that matches 2 of them — verify those 2 get `needs_review: true` and reduced confidence, the third is unchanged; unit test that confidence does not go below 0
  - Done when: Directory prefix matching works (not just exact file match); confidence floor at 0; `index.yaml` written; `tsc --noEmit` 0 errors

- [ ] **Task 5: Extend knowledge injector with freshness warnings and source annotation**
  - Description: In `src/knowledge/injector.ts`, add `checkFileFreshness(entry: KnowledgeEntry, projectRoot: string): boolean`. For each `related_file` in the entry, compare `entry.created` to file `mtime`. If `mtime > entry.created` and `changeRatio > config.knowledge.decay.stale_file_change_ratio` (default 0.3), return false (not fresh). Estimate `changeRatio` via `git diff --shortstat` between the entry creation date and now. When injecting a non-fresh entry, prepend: `⚠ Created <N> days ago; <file> modified since — verify before adopting.`. Annotate all injected entries with `(from task: "<source_task>", <N> days ago)` regardless of freshness.
  - Files: `src/knowledge/injector.ts`
  - Tests: Unit test with a fixture entry where related file mtime is after `created` and change ratio > 0.3 — verify warning line appears first in injected text; unit test with a fresh entry — verify no warning; unit test that source annotation appears on all entries
  - Done when: Warning conditional on both mtime and change ratio; annotation always present; `tsc --noEmit` 0 errors

- [ ] **Task 6: Add `reins knowledge --check-promotions` and `reins knowledge --consistency` CLI subcommands**
  - Description: Add `knowledge` subcommand to `src/cli.ts` with two flags. `--check-promotions`: load all knowledge entries from `index.yaml`, call `evaluatePromotions()`, print each candidate with its `targetType` and `reason`; if `promotion.auto_suggest: true` in config, print a formatted suggestion prompt. `--consistency`: read the list of files modified in the current session (from the most recent execution observation), call `runConsistencyCheck()`, print the `ConsistencyReport` summary. Update the `SessionEnd` hook template to call both commands after `reins learn --auto`.
  - Files: `src/cli.ts`, hook template
  - Tests: Integration test `reins knowledge --check-promotions` with a fixture index containing one entry meeting all promotion conditions — verify output includes the entry id and targetType; test `--check-promotions` with no qualifying entries exits 0 with "No promotion candidates" message
  - Done when: Both flags registered; `--check-promotions` output includes candidate details; `--consistency` prints report; both exit 0 on empty input; hook template updated
