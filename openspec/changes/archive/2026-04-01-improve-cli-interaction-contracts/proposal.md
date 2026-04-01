## Why

Reins currently presents itself as a guided CLI product, but the live command surface, help output, README, and failure messages do not consistently match what the tool can actually do. That interaction gap creates expectation debt, weakens trust at first use, and makes recovery harder when users hit missing or partial features.

This change is needed now because the project already exposes a broad workflow narrative around `init`, `develop`, `update`, `hook`, `status`, and `rollback`, but core interaction contracts remain unreliable. Before expanding capability breadth, the CLI needs a truthful, coherent, and recoverable user experience.

## What Changes

- Align CLI help text, README command documentation, and runtime behavior so users are never taught commands or options that do not exist.
- Define a consistent interaction contract for unsupported, partial, and gated commands, including when to hide commands versus when to return an explicit “not yet implemented” experience.
- Improve empty states, failure states, and recovery messages so each dead end gives a concrete next step.
- Strengthen destructive or high-risk flows such as rollback with clearer previews, confirmation, and outcome summaries.
- Tighten status and suggestion output so it communicates confidence and evidence instead of low-signal recommendations.

## Capabilities

### New Capabilities
- `cli-interaction-contracts`: Defines the required behavior for command discoverability, help accuracy, unsupported feature handling, recovery messaging, and operator-safe CLI flows in Reins.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/cli.ts`, `src/commands/init.ts`, `src/commands/status.ts`, `src/commands/test-cmd.ts`, `src/commands/hook-cmd.ts`, `src/commands/rollback.ts`, supporting tests, and `README.md`
- Affected systems: CLI discoverability, onboarding, failure recovery, rollback interaction, command documentation
- APIs/UX: command help output, README examples, unsupported command behavior, status suggestions, rollback prompts
- Phase: MVP usability and trust hardening for the command-line surface defined in `modules/01-cli-state.md` and `modules/05-pipeline-runner.md`
