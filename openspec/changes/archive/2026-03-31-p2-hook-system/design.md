## Approach

Generate deterministic shell scripts from the `enforcement` fields of each constraint in `constraints.yaml`, then write a `.claude/settings.json` that registers those scripts against the appropriate Claude Code hook events. The generator is a pure TypeScript function: read constraints, render templates, write files. No runtime hook execution happens in Node — hooks run entirely in bash when Claude Code fires them.

## Architecture

**Generator pipeline** (`src/hooks/generator.ts`):
- `loadEnforceableConstraints(constraintsPath)` reads `constraints.yaml` and filters to constraints where `enforcement.hook == true`
- `selectTemplate(hookType)` maps `hook_type` values (`post_edit`, `pre_bash`, `pre_complete`, `context_inject`) to the corresponding `.sh.tmpl` file
- `renderTemplate(template, constraint)` does simple `{{variable}}` substitution: fills `{{CONSTRAINT_ID}}`, `{{CHECK_PATTERN}}`, `{{ERROR_MESSAGE}}`, `{{MODE}}` from the constraint's enforcement block
- `writeHookScript(outputDir, constraintId, rendered)` writes to `.reins/hooks/<constraint-id>.sh` and sets mode `0o755`
- Exported entry: `generateHooks(projectRoot, constraintsPath)` — runs the full pipeline and returns a list of `HookConfig` objects for the settings writer

**Settings writer** (`src/hooks/settings-writer.ts`):
- `generateSettingsJson(projectRoot, hooks)` builds the settings object by bucketing `HookConfig[]` into the four event arrays: `PostToolUse` (matcher `Edit|Write`), `PreToolUse` (matcher `Bash` for bash-guard; matcher `Edit|Write` for protection), `Stop`, `UserPromptSubmit`
- Always appends the constraint-protection hook entry to `PreToolUse` regardless of the constraint list
- Merges into an existing `.claude/settings.json` if present (preserves user-defined hooks not managed by reins); reins-managed entries are identified by a `"_reins": true` marker in each entry object
- Writes atomically: writes to a temp file then renames

**Protection hook** (`src/hooks/protection.ts`):
- `generateProtectionHook(outputDir)` renders the protection script (hardcoded, no template substitution) into `.reins/hooks/protect-constraints.sh`
- The script checks `FILE` from stdin JSON for paths matching `\.reins/constraints\.yaml`, `\.reins/config\.yaml`, or `\.reins/hooks/`; exits 2 with a clear error message if matched

**Templates** (`src/hooks/templates/`):
- `post-edit-check.sh.tmpl`: reads `FILE` from jq, applies a regex pattern check (`{{CHECK_PATTERN}}`), exits 2 with `{{ERROR_MESSAGE}}` if matched; mode controlled by `{{MODE}}`
- `bash-guard.sh.tmpl`: reads `CMD` from jq, applies pattern check, exits 2 on match
- `pre-complete.sh.tmpl`: runs a configurable shell command (`{{CHECK_COMMAND}}`); exits 2 on non-zero
- `context-inject.sh.tmpl`: reads `PROMPT` from jq, checks for keyword patterns, prints context paths to stdout if matched; always exits 0

**Mode handling**: each template includes a mode gate at the top — if `MODE=warn`, the script prints to stdout and exits 0 instead of stderr + exit 2. If `MODE=off`, the script immediately exits 0.

## Key Decisions

- **Shell scripts over Node scripts for hooks**: Claude Code hook commands must be fast (< 200ms typical). Shell + `jq` adds near-zero overhead. A Node process startup would add 300–500ms per hook invocation, which multiplies across every file edit.
- **Template substitution over code generation**: Simple `{{variable}}` replacement keeps templates readable and auditable by users. The generated scripts are plain bash that any developer can read and modify directly.
- **Merge strategy for settings.json**: Reins must not clobber user-managed hook entries. The `"_reins": true` marker lets the writer identify and replace only its own entries on regeneration, leaving user entries untouched.
- **Protection hook is always hardcoded**: It must never be derived from user-editable constraints — that would allow a constraint change to disable its own protection. The script is rendered from a constant in `protection.ts`, not a template file.
- **jq availability check in each script**: Every generated script starts with `command -v jq >/dev/null || { echo "reins hooks require jq" >&2; exit 0; }`. Exit 0 (not 2) so a missing jq degrades gracefully rather than blocking all edits.

## File Structure

```
src/hooks/
├── generator.ts              # generateHooks(projectRoot, constraintsPath): HookConfig[]
├── settings-writer.ts        # generateSettingsJson(projectRoot, hooks: HookConfig[]): void
├── protection.ts             # generateProtectionHook(outputDir): void
└── templates/
    ├── post-edit-check.sh.tmpl
    ├── bash-guard.sh.tmpl
    ├── pre-complete.sh.tmpl
    └── context-inject.sh.tmpl

.reins/hooks/                 # generated output (team-shared, committed to git)
    ├── protect-constraints.sh
    ├── <constraint-id>.sh    # one per enforced constraint
    └── ...

.claude/
    └── settings.json         # generated + merged output
```
