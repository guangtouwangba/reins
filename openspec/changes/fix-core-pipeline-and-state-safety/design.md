## Context

This is a cross-cutting MVP hardening change across the CLI+State, Scanner, Pipeline Runner, Evaluation, and Hook System modules described in `modules/01-cli-state.md`, `modules/02-scanner.md`, `modules/05-pipeline-runner.md`, and `modules/06-evaluation.md`. The current implementation has three classes of problems:

- change detection is anchored to `.reins/` artifacts instead of the project inputs that should drive constraint regeneration
- pipeline success is not coupled tightly enough to QA and evaluation outcomes
- safety-oriented command semantics (`dry-run`, settings merge, snapshot restore, auto-apply) do not match the user-facing contract

The change must preserve the existing TypeScript CLI shape and `constraints.yaml` schema while making runtime behavior trustworthy. It should avoid adding new persistence formats or new external dependencies.

Relevant existing interfaces and structures:

- `ReinsConfig` in `src/state/config.ts` remains the source for tool config, while `ConstraintsConfig.pipeline` in `src/constraints/schema.ts` remains the source for generated pre-commit and post-develop commands.
- `Manifest` in `src/state/manifest.ts` is currently used for incremental diffing and needs its scope clarified.
- `PipelineResult` / `StageResult` in `src/pipeline/types.ts` should continue to report stage-level execution while reflecting true gate failures.

## Goals / Non-Goals

**Goals:**
- Make `update` compare and persist the correct manifest scope for project-driven regeneration.
- Ensure QA executes the commands defined by generated pipeline configuration and that failed evaluation gates fail the pipeline.
- Make `init --dry-run` fully non-mutating.
- Prevent silent destructive overwrite when reading malformed user settings.
- Make snapshot restore produce an exact restore for captured files.
- Make `--auto-apply` behavior match schema-backed data rather than undocumented fields.

**Non-Goals:**
- Implement the full `develop` command.
- Redesign the OpenSpec or `.reins` data model beyond what is required for correctness.
- Introduce a probabilistic confidence system for constraints in this change.
- Expand hook coverage beyond the correctness fixes already implied by current behavior.

## Decisions

### 1. Separate project-input manifest tracking from generated-state persistence

`update` should diff against project files that influence constraint generation, not `.reins` outputs. The manifest builder should either accept a target root/exclude set or a dedicated project-input builder should be added. The saved manifest should be regenerated after successful writes so the recorded state reflects the post-update baseline.

Alternatives considered:
- Keep tracking `.reins/` and special-case generated files: rejected because it keeps feedback loops in the diff model.
- Remove manifest-based update entirely: rejected because incremental update remains a useful MVP behavior.

### 2. Source QA commands from `constraints.yaml`, not `ReinsConfig`

The pipeline runner should load `ConstraintsConfig` once and pass the generated `pipeline.pre_commit` and `pipeline.post_develop` commands into QA execution. `ReinsConfig` should continue to control runtime defaults, but not generated QA command lists.

Alternatives considered:
- Copy pipeline command arrays into `ReinsConfig`: rejected because it duplicates generated state and weakens the `constraints.yaml` contract.
- Let QA silently pass when no commands are found: rejected because it hides misconfiguration.

### 3. Tie stage success to enforcement gates, not just transport success

The `ralph` stage must fail when required evaluation conditions are not satisfied, even if the bridge call itself returned successfully. Stage output can still include detailed evaluation and exit-decision data, but `StageResult.success` must represent actual gate success.

Alternatives considered:
- Preserve current behavior and rely on logs only: rejected because pipeline success becomes semantically meaningless.

### 4. Make dry-run and overwrite semantics explicit and safe

`scan()` should support a non-persisting path so `init --dry-run` performs no writes. For `--force` and `--diff`, either implement the documented behavior in `initCommand()` or remove the options from the CLI surface in the same change if implementation is not justified.

Alternatives considered:
- Keep the options as placeholders: rejected because this is a user-contract bug, not a missing enhancement.

### 5. Fail safe on malformed user settings and exact snapshot restore

When `.claude/settings.json` cannot be parsed, settings generation should stop with a clear error rather than overwrite user configuration. Snapshot restore should delete captured top-level files absent from the snapshot, not only files inside captured directories.

Alternatives considered:
- Auto-reset malformed settings to `{}`: rejected because it causes silent data loss.
- Only partially restore snapshots: rejected because rollback must be trustworthy.

### 6. Remove unsupported confidence gating from auto-apply

Because `Constraint` has no `confidence` field in the schema, `--auto-apply` should be defined in terms of conflict-free changes only, or confidence should remain out of scope until schema support exists. This change will align implementation and CLI messaging to the schema-backed model.

Alternatives considered:
- Keep casting to an ad hoc `confidence` field: rejected because it creates undocumented behavior.

## Risks / Trade-offs

- [Update scope correction may change when users see regeneration trigger] → Mitigate with targeted tests covering project-file edits versus `.reins`-only edits.
- [Failing the pipeline on evaluation gates may expose previously hidden failures] → Mitigate with explicit stage output and fixture tests for each profile.
- [Fail-safe settings parsing may block users with malformed files] → Mitigate with actionable error text that points to the invalid file path.
- [Exact snapshot restore may remove files users expected to keep] → Mitigate by limiting deletes strictly to captured paths and testing rollback scenarios.

## Migration Plan

1. Update manifest-building logic and persist the corrected post-write baseline.
2. Refactor pipeline loading so QA and evaluation use generated pipeline configuration from `constraints.yaml`.
3. Introduce non-persisting scan behavior for dry-run and reconcile `init` option semantics.
4. Harden settings merge and snapshot restore logic.
5. Update CLI/help text and tests to match the final supported behavior.
6. Validate with unit tests plus command-level flows for `init`, `update`, and pipeline execution.

## Open Questions

- Should `init --force` be implemented as unconditional overwrite, or should the option be removed until there is a concrete merge/overwrite strategy?
- Should manifest tracking cover the entire repository minus configured exclusions, or only files that materially influence scanner/constraint generation?
