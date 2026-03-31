## 1. Manifest and update correctness

- [ ] 1.1 Refactor `src/state/manifest.ts` and `src/commands/update.ts` so update diffs project input files instead of `.reins/` generated artifacts, and add tests covering source-file changes versus `.reins`-only changes.
- [ ] 1.2 Update `src/commands/update.ts` to persist the post-write manifest baseline after `constraints.yaml` is written, and add a regression test proving the next update run does not treat the previous write as fresh drift.
- [ ] 1.3 Reconcile `update --auto-apply` semantics in `src/commands/update.ts` and related help text/schema usage so it no longer depends on unsupported `confidence` fields, and add tests for conflict-free and conflicting update flows.

## 2. Pipeline gate enforcement

- [ ] 2.1 Refactor `src/pipeline/runner.ts` and `src/pipeline/qa.ts` so QA commands are loaded from generated `ConstraintsConfig.pipeline` data, and add tests that prove configured QA commands execute and fail the pipeline when a command fails.
- [ ] 2.2 Update `src/pipeline/runner.ts` so verification stage success depends on required evaluation gates as well as bridge execution success, and add profile-based tests for pass/fail exit conditions.
- [ ] 2.3 Reduce noisy git error handling in `src/evaluation/l1-coverage.ts` for environments without a usable git staging context, and add tests that keep evaluation output clean while preserving coverage checks where supported.

## 3. Safe command semantics and state writes

- [ ] 3.1 Add a non-persisting scan path in `src/scanner/scan.ts` and wire `src/commands/init.ts` so `reins init --dry-run` performs zero writes, with tests asserting no `.reins` or adapter artifacts are created.
- [ ] 3.2 Implement or remove the advertised `--force` and `--diff` behavior in `src/cli.ts` and `src/commands/init.ts`, and add command-level tests to verify the final CLI contract matches runtime behavior.
- [ ] 3.3 Harden `src/hooks/settings-writer.ts` to fail safely on malformed `.claude/settings.json`, and add tests proving invalid JSON does not get silently overwritten.
- [ ] 3.4 Update `src/state/snapshot.ts` so restore deletes captured top-level files absent from the snapshot as well as directory entries, and add rollback tests proving restored state matches the snapshot exactly.

## 4. Verification

- [ ] 4.1 Run `npm run lint` and `npm test`, then add or update focused tests for `init`, `update`, pipeline execution, settings merge, and snapshot restore to cover every regression fixed by this change.
- [ ] 4.2 Manually verify the user-facing flows `reins init --dry-run`, `reins update`, and rollback behavior against the new semantics, and document any remaining follow-up work in the change notes if gaps remain.
