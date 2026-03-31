## Tasks

- [ ] **Task 1: Create Observer (`learn/observer.ts`)**
  - Description: Create `src/learn/observer.ts`. Define and export `ExecutionObservation` interface with all fields from module ⑧: `sessionId`, `taskDescription`, `timestamp`, `duration`, `outcome`, `agentsUsed[]`, `toolsUsed[]`, `filesModified[]`, `testsRun`, `errors[]`, `retries[]`, `humanInterventions[]`, `constraintViolations[]`, `reviewFeedback[]`, `learnings[]`. Export `recordObservation(sessionId: string, data: Partial<ExecutionObservation>, projectRoot: string): void` — merges data with any existing partial observation for the session, writes complete record to `.reins/logs/executions/exec-<id>.yaml`. Export `loadObservations(projectRoot: string, since?: Date): ExecutionObservation[]` — reads all `exec-*.yaml` files in the executions directory, optionally filtering by timestamp.
  - Files: `src/learn/observer.ts`
  - Tests: Unit test that `recordObservation` writes a valid YAML file with all required fields; unit test that `loadObservations` returns records within the date window and excludes records outside it
  - Done when: Both interfaces exported; write and read round-trip correctly; `tsc --noEmit` 0 errors

- [ ] **Task 2: Create Scorer (`learn/scorer.ts`)**
  - Description: Create `src/learn/scorer.ts`. Export `scoreSkillCandidate(candidate: SkillDraft): number`. Implement the weighted scoring table exactly: base 50, +15 file paths present, +15 error messages present, +5 per high-value keyword (list: error, fix, workaround, failed, avoid, broken, root cause, regression) capped at +20, +10 per repeat occurrence in logs capped at +30, +10 solution body > 100 chars, -15 generic phrases (list: try again, check docs, read the docs, see documentation), -20 content < 50 chars, -25 no trigger pattern. Return clamped integer 0-100.
  - Files: `src/learn/scorer.ts`
  - Tests: Unit test for each bonus factor in isolation; unit test for each penalty factor; unit test that a well-formed skill (file path + error + two keywords + trigger) scores above 70; unit test that a short generic skill with no trigger scores below 30
  - Done when: All factor tests pass; scoring is deterministic (same input always same output); `tsc --noEmit` 0 errors

- [ ] **Task 3: Create Analyzer (`learn/analyzer.ts`)**
  - Description: Create `src/learn/analyzer.ts`. Export `analyze(observations: ExecutionObservation[]): AnalysisResult`. Implement metric computation (avgTaskDuration, successRate, avgRetries, humanInterventionRate). Implement pattern detection: errors appearing >= 3 times → `recurringErrors` with `suggestedConstraint`; interventions appearing >= 3 times → `recurringInterventions`; tool sequences correlating with faster completion → `efficientPatterns`; constraints violated in >= 50% of applicable sessions → `ignoredConstraints`. Produce `Action[]` with typed variants and confidence scores. Export `generateWeeklyReport(projectRoot: string, observations: ExecutionObservation[]): void` — writes `.reins/reports/weekly-YYYY-WNN.yaml` if it does not already exist for the current week.
  - Files: `src/learn/analyzer.ts`
  - Tests: Unit test with 10 observations where one error appears 4 times — verify it appears in `recurringErrors`; unit test with 5 observations all succeeding — verify `successRate` is 1.0; unit test that `generateWeeklyReport` does not overwrite an existing report file
  - Done when: Pattern detection thresholds correct; metrics computed correctly; weekly report idempotent; `tsc --noEmit` 0 errors

- [ ] **Task 4: Create Promoter (`learn/promoter.ts`)**
  - Description: Create `src/learn/promoter.ts`. Define and export `SkillLifecycle` interface. Export `updateLifecycle(skill: SkillLifecycle): SkillLifecycle` implementing the state machine: Draft(50) + score >= 70 → Active; Active + usageCount >= 5 + successRate >= 80% → Verified; Verified + score >= 90 → Promoted; any state + score <= 30 → Declining; Declining + score <= 0 → Archived. Export `archiveSkill(skillPath: string, projectRoot: string): void` — moves skill file to `.reins/skills/archive/`.
  - Files: `src/learn/promoter.ts`
  - Tests: Unit test each valid state transition with boundary scores; unit test that a skill does not transition without meeting all conditions (e.g. Verified requires both usageCount AND successRate); unit test that Archived triggers `archiveSkill` call
  - Done when: All 6 transitions covered; boundary conditions correct; `tsc --noEmit` 0 errors

- [ ] **Task 5: Create Constraint Updater (`learn/constraint-updater.ts`)**
  - Description: Create `src/learn/constraint-updater.ts`. Export `applyActions(actions: Action[], projectRoot: string): void`. For each action type: `update_constraint` mutates the rule in the loaded constraints object; `create_skill` writes YAML to `.reins/skills/auto/<name>.yaml`; `add_hook` appends hook entry; `remove_constraint` sets `deprecated: true` and `deprecationReason` without deleting. After processing all actions, call `recompileConstraints()` to regenerate target formats. Append a changelog entry to `.reins/logs/constraint-changelog.yaml` with `timestamp`, `actionType`, `confidence`, `rule`, `before`, `after`.
  - Files: `src/learn/constraint-updater.ts`
  - Tests: Unit test `update_constraint` — verify rule value changes and changelog entry is written; unit test `remove_constraint` — verify rule still exists with `deprecated: true` and original value preserved; unit test that `recompileConstraints` is called exactly once per `applyActions` call regardless of action count
  - Done when: All four action types handled; deprecation preserves original value; changelog append-only; recompile called once; `tsc --noEmit` 0 errors

- [ ] **Task 6: Create Learner (`learn/learner.ts`)**
  - Description: Create `src/learn/learner.ts`. Export `applyLearnings(actions: Action[]): LearnerReport`. Partition actions by confidence: > 85 → auto-apply via `ConstraintUpdater.applyActions`; 60-85 → write to `.reins/logs/pending-actions.yaml` and emit suggestion message to stdout; < 60 → append to `.reins/logs/low-confidence.yaml`. Return `LearnerReport { autoApplied: number, suggested: number, logged: number }`.
  - Files: `src/learn/learner.ts`
  - Tests: Unit test with 3 actions at confidence 90, 75, 50 — verify counts in report match; unit test that auto-apply calls `applyActions`; unit test that suggest path writes to `pending-actions.yaml` without calling `applyActions`
  - Done when: Partition logic correct at boundary values (85 and 60 inclusive); report counts accurate; `tsc --noEmit` 0 errors

- [ ] **Task 7: Add `reins learn --auto` CLI command and SessionEnd hook wiring**
  - Description: Add `learn` subcommand to `src/cli.ts` with `--auto` flag. When `--auto` is set: call `loadObservations()`, `analyze()`, `applyLearnings()`, and `generateWeeklyReport()` in sequence; print a summary to stdout. Update `.reins/hooks/session-end.sh` template (generated by `reins init`) to call `reins learn --auto` after the existing staleness check.
  - Files: `src/cli.ts`, relevant hook template in `src/`
  - Tests: Integration test that `reins learn --auto` with a fixture executions directory produces a `LearnerReport` and exits 0; test that it exits 0 with an empty executions directory (no observations yet)
  - Done when: Command registered; runs pipeline end-to-end; empty executions directory does not error; session-end hook template updated
