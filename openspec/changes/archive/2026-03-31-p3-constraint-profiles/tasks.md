## Tasks

- [ ] **Task 1: Add Profile type to schema and implement profiles.ts**
  - Description: Add `Profile` and `ResolvedProfile` interfaces to `src/constraints/schema.ts`. Add the `profiles` field to the `ConstraintsFile` interface. Implement `loadProfiles(projectRoot)` in `src/constraints/profiles.ts` — reads from `constraints.yaml` and merges with hardcoded built-in defaults (`strict`, `default`, `relaxed`, `ci`). Implement `resolveProfile(name, allConstraints, projectRoot)` — filters constraints and hooks by the profile's severity spec, returns `ResolvedProfile`.
  - Files: `src/constraints/schema.ts`, `src/constraints/profiles.ts`
  - Tests: Unit test `resolveProfile('relaxed', ...)` returns only critical constraints; test `resolveProfile('strict', ...)` returns all constraints; test fallback to `default` when an unknown profile name is given; test that user-defined profiles in `constraints.yaml` override built-in defaults.
  - Done when: `resolveProfile` is exported and passes all unit tests; unknown profile name falls back gracefully; built-in profiles are always available even if `profiles:` section is absent from `constraints.yaml`.

- [ ] **Task 2: Implement conflict-detector.ts**
  - Description: Implement `detectConflicts(existing, incoming)` in `src/constraints/conflict-detector.ts`. A conflict is defined as same `id`, different `rule` text (trimmed). Constraints with `source: 'manual'` in existing are never returned as conflicts.
  - Files: `src/constraints/conflict-detector.ts`
  - Tests: Unit test same id + same rule → no conflict; test same id + different rule → conflict; test `source: 'manual'` existing constraint is never in conflict result; test multiple conflicts returned correctly.
  - Done when: `detectConflicts` exported and passing all unit tests; no false positives on whitespace-only differences.

- [ ] **Task 3: Implement merger.ts**
  - Description: Implement `mergeConstraints(existing, incoming)` in `src/constraints/merger.ts` following the five merge rules: manual → kept; matching id + rule → kept; matching id + different rule + not manual → conflict; missing from incoming + not manual → deprecated (set `status: 'deprecated'`); new in incoming → added (set `source: 'auto'`, `status: 'draft'`). Calls `detectConflicts` internally.
  - Files: `src/constraints/merger.ts`
  - Tests: Unit test each of the five merge rule paths with a minimal fixture; test that `deprecated` items retain their original data except for the added `status` field; test that `added` items have `source: 'auto'` and `status: 'draft'`; test empty existing and empty incoming edge cases.
  - Done when: `mergeConstraints` exported and passing all unit tests; all five rules produce the correct output classification.

- [ ] **Task 4: Wire merge strategy into reins init**
  - Description: Update `src/cli.ts` to add `--merge` (default), `--force`, and `--diff` flags to the `init` command. In the init handler: if `.reins/` does not exist, proceed with existing full-init flow. If it exists and `--force`: save snapshot then overwrite. If `--diff`: run merge computation, print summary diff, exit without writing. If `--merge` (default): run `mergeConstraints`, print summary (N kept, N added, N deprecated, N conflicts), resolve conflicts interactively, write result, save snapshot.
  - Files: `src/cli.ts`
  - Tests: Integration test that `reins init` on an existing project with manual constraints preserves them; test that `--diff` produces output but makes no file changes; test that `--force` creates a pre-force snapshot before overwriting; test that conflicts prompt the user and respect their choice.
  - Done when: All three init modes work correctly; `--merge` is the default when `.reins/` exists; no user modifications are silently overwritten.

- [ ] **Task 5: Wire --profile into reins develop**
  - Description: Update the `develop` command in `src/cli.ts` to pass the `--profile` option value to `resolveProfile`. The resolved `activeConstraints`, `activeHooks`, and `pipelineStages` are passed to the pipeline runner instead of the full unfiltered sets. Default profile is `default` (reads from `config.yaml develop.constraint_profile`).
  - Files: `src/cli.ts`
  - Tests: Unit test that `--profile relaxed` results in only critical constraints being passed to the pipeline; test that omitting `--profile` uses the config default; test that an unknown profile name prints a warning and falls back to `default`.
  - Done when: `reins develop --profile strict` and `--profile relaxed` demonstrably pass different constraint sets to the pipeline runner.
