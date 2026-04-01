## Why

The current Reins CLI has several runtime correctness gaps in its core execution path: `update` tracks the wrong manifest scope, pipeline verification can report success even when required checks never ran or failed, and file-writing commands do not consistently honor their advertised safety semantics. These issues affect the trustworthiness of generated constraints and make the MVP behavior diverge from the design intent described in `modules/00-overview.md`, `modules/05-pipeline-runner.md`, and `modules/06-evaluation.md`.

This change is needed now because these bugs sit on the main user path (`init`, `update`, `develop` pipeline primitives, rollback/state restore) and undermine the product's core promise: constraint governance that is safe, observable, and enforceable.

## What Changes

- Correct manifest generation and diffing so `reins update` responds to meaningful project changes instead of `.reins/` self-generated artifacts.
- Make pipeline QA and verification stages enforce actual success criteria, including failing the pipeline when required evaluation gates are not met.
- Align CLI behavior with its contract by making `init --dry-run` non-mutating and ensuring documented overwrite/diff safety controls are either implemented or removed.
- Harden state-writing paths so settings merges, manifest persistence, and snapshot restore behavior avoid silent data loss or stale state.
- Clarify auto-apply semantics so update behavior matches the confidence model actually supported by the schema.

## Capabilities

### New Capabilities
- `runtime-safety-and-pipeline-enforcement`: Defines the required behavior for manifest tracking, pipeline QA/evaluation gating, dry-run safety, and state restore/write correctness across the Reins CLI.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/commands/init.ts`, `src/commands/update.ts`, `src/pipeline/runner.ts`, `src/pipeline/qa.ts`, `src/scanner/scan.ts`, `src/state/manifest.ts`, `src/state/snapshot.ts`, `src/hooks/settings-writer.ts`, `src/cli.ts`
- Affected systems: CLI command contract, pipeline execution flow, `.reins` state management, `.claude/settings.json` merge behavior
- APIs/UX: `init --dry-run`, `init --force`, `init --diff`, `update --auto-apply`, pipeline success/failure semantics
- Phase: MVP hardening of core workflow before broader `develop` implementation proceeds
