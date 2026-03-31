## Why

Soft constraints in CLAUDE.md are advisory — an agent can ignore, forget, or misinterpret them. Phase 2 needs a deterministic enforcement layer that intercepts violations at the tool-call level, before bad code is written or dangerous commands are run.

## What Changes

- Add `src/hooks/generator.ts` to read `constraints.yaml` and emit shell scripts for each constraint where `enforcement.hook == true`
- Add `src/hooks/settings-writer.ts` to generate `.claude/settings.json` with hook registrations for all 4 hook types (PostToolUse:Edit/Write, PreToolUse:Bash, Stop, UserPromptSubmit)
- Add `src/hooks/protection.ts` to generate the constraint-protection hook that blocks agent modification of `.reins/constraints.yaml`, `.reins/config.yaml`, and `.reins/hooks/`
- Add shell script templates under `src/hooks/templates/`: `post-edit-check.sh.tmpl`, `bash-guard.sh.tmpl`, `pre-complete.sh.tmpl`, `context-inject.sh.tmpl`
- Wire hook generation into the `reins init` flow so hooks are produced alongside constraints
- Support 3 execution modes per hook: `block` (exit 2, stops the tool call), `warn` (exit 0 + stdout, advisory), `off` (hook not registered)
- Default severity mapping: `critical` → `block`, `important` → `warn`, `helpful` → `off`

## Capabilities

### New Capabilities

- `hook-generator`: Reads `enforcement.hook_type` and `enforcement.hook_check` from each constraint in `constraints.yaml` and renders the appropriate shell script template into `.reins/hooks/<constraint-id>.sh`
- `settings-writer`: Produces `.claude/settings.json` with all four hook event sections populated from the active hook set, always including the constraint-protection hook
- `constraint-protection`: A permanently-registered `PreToolUse:Edit|Write` hook that blocks any agent attempt to directly modify `.reins/constraints.yaml`, `.reins/config.yaml`, or any file under `.reins/hooks/`
- `hook-execution-modes`: Per-hook `block`/`warn`/`off` mode controlled by `enforcement.hook_mode` in `constraints.yaml`; can be overridden in `config.yaml` via `hooks.default_mode`

### Modified Capabilities

- `reins-init`: Extended to call hook generator and settings-writer after constraint generation, producing a complete hook set as part of `reins init`

## Impact

- Produces `.reins/hooks/*.sh` (shell scripts, executable, committed to git as team-shared)
- Produces `.claude/settings.json` (must not conflict with any user-managed settings; generator merges into existing file if present)
- Downstream: `p2-pipeline-runner` depends on hook scripts being present before pipeline execution begins
- Requires `jq` at runtime in the shell scripts; generator should emit a `jq` availability check at the top of each script
- `mvp-constraint-engine` must already have written `constraints.yaml` with `enforcement` fields before hook generation runs
