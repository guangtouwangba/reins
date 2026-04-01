## 1. Command contract alignment

- [ ] 1.1 Audit `src/cli.ts` and `README.md` to remove, relabel, or explicitly gate unsupported commands, subcommands, options, and output formats, and add tests that assert `--help` output matches the supported command surface.
- [ ] 1.2 Reconcile the `develop`, `hook`, `status`, `init`, and `update` command contracts so runtime behavior matches documented capability, and add command-level tests for each previously mismatched interaction.

## 2. Failure and empty-state improvements

- [ ] 2.1 Standardize actionable empty-state and failure-state copy across `src/commands/status.ts`, `src/commands/test-cmd.ts`, `src/commands/hook-cmd.ts`, and related handlers so every dead end includes a concrete next step, with tests for missing-init, missing-hooks, and invalid-action flows.
- [ ] 2.2 Remove remediation guidance that points to unsupported commands such as `hook fix`, and add regression tests that assert failure messages only reference available commands.
- [ ] 2.3 Rework `src/commands/status.ts` suggestion logic so low-confidence heuristics are omitted or downgraded to observational language, and add tests covering zero-violation and low-signal reporting cases.

## 3. Safer high-risk interaction flows

- [ ] 3.1 Update `src/commands/rollback.ts` to provide clearer snapshot summaries, confirmation behavior for interactive rollback, and a stronger preflight/completion summary for `--to`, with tests for both interactive and direct-id flows.
- [ ] 3.2 Review other state-changing command outputs in `src/commands/init.ts`, `src/commands/update.ts`, and `src/commands/hook-cmd.ts` so completion summaries clearly describe what changed, and add focused output tests.

## 4. Documentation and verification

- [ ] 4.1 Update `README.md` command examples and onboarding guidance so the documented user journey reflects the actual CLI interaction model.
- [ ] 4.2 Run `npm run lint` and `npm test`, then add or update tests for help output, unsupported-command guidance, empty states, rollback messaging, and status formatting to verify the interaction contract end to end.
