## Tasks

- [ ] **Task 1: Create shell script templates**
  - Description: Write the four `.sh.tmpl` files under `src/hooks/templates/`. Each template reads hook event JSON from stdin via `jq`, applies its check logic, and exits appropriately. Include the `jq` availability guard at the top of each. Use `{{CONSTRAINT_ID}}`, `{{CHECK_PATTERN}}`, `{{ERROR_MESSAGE}}`, `{{MODE}}`, and `{{CHECK_COMMAND}}` as substitution variables. The mode gate (`warn` vs `block`) must be handled inside each template.
  - Files: `src/hooks/templates/post-edit-check.sh.tmpl`, `src/hooks/templates/bash-guard.sh.tmpl`, `src/hooks/templates/pre-complete.sh.tmpl`, `src/hooks/templates/context-inject.sh.tmpl`
  - Tests: Unit test that a rendered `post-edit-check` template with a known pattern exits 2 when the pattern matches and exits 0 when it does not; test that `warn` mode always exits 0 regardless of match
  - Done when: All four templates are present; substitution variables are documented with a comment in each file; the jq guard is present in each

- [ ] **Task 2: Implement `protection.ts` — constraint protection hook**
  - Description: Write `generateProtectionHook(outputDir: string): void`. This function renders a hardcoded (no template) shell script into `outputDir/protect-constraints.sh`. The script reads `FILE` from stdin JSON via `jq`, checks if the path matches `.reins/constraints.yaml`, `.reins/config.yaml`, or any path under `.reins/hooks/`, and exits 2 with a clear error message if matched. Set file mode `0o755`. This function must not read from any constraint or config file — the protection script is always the same.
  - Files: `src/hooks/protection.ts`
  - Tests: Call `generateProtectionHook()` into a temp directory; read the output file and verify the protected path patterns are present; verify file mode is executable
  - Done when: `protect-constraints.sh` is written with correct patterns and is executable; function is exported from `src/hooks/protection.ts`

- [ ] **Task 3: Implement `generator.ts` — hook script generator**
  - Description: Write `generateHooks(projectRoot: string, constraintsPath: string): HookConfig[]`. Load and parse `constraintsPath` (YAML), filter to constraints where `enforcement.hook === true`, map each to its template using `selectTemplate(hookType)`, render via `{{variable}}` substitution, write the output script to `${projectRoot}/.reins/hooks/${constraintId}.sh` with mode `0o755`, and return a `HookConfig[]` array. Define `HookConfig` interface: `{ constraintId, hookType, scriptPath, mode, description }`. Also call `generateProtectionHook()` so the protection script is always produced alongside the constraint-derived scripts.
  - Files: `src/hooks/generator.ts`
  - Tests: Provide a fixture `constraints.yaml` with two enforced constraints (one `post_edit`, one `pre_bash`) and verify that two scripts are written with correct content; verify the protection script is also written; verify returned `HookConfig[]` has the correct entries
  - Done when: `generateHooks()` writes correct scripts for all enforced constraints; `HookConfig[]` is returned; protection hook is always included

- [ ] **Task 4: Implement `settings-writer.ts` — `.claude/settings.json` generator**
  - Description: Write `generateSettingsJson(projectRoot: string, hooks: HookConfig[]): void`. Build the settings object by bucketing `HookConfig[]` into the four event arrays. Mark each reins-managed entry with `"_reins": true`. If `.claude/settings.json` already exists, read it and preserve any entries where `"_reins"` is absent or false (user-managed), replacing only entries where `"_reins": true`. Always append the constraint-protection hook entry. Write atomically (temp file + rename). Create `.claude/` directory if it does not exist.
  - Files: `src/hooks/settings-writer.ts`
  - Tests: Test with no existing `settings.json` — verify the file is created with all four event sections; test with an existing file containing a user-managed hook — verify the user hook is preserved; test that the protection hook entry is always present
  - Done when: `generateSettingsJson()` writes correct settings; user-managed entries are preserved on regeneration; protection hook is always present; file is written atomically

- [ ] **Task 5: Wire hook generation into `reins init`**
  - Description: After `mvp-constraint-engine` writes `constraints.yaml`, call `generateHooks(projectRoot, constraintsPath)` and then `generateSettingsJson(projectRoot, hooks)`. Add a summary line to the init output: `Generated N hook scripts → .reins/hooks/` and `Registered hooks → .claude/settings.json`. If `.reins/hooks/` does not exist, create it.
  - Files: `src/commands/init.ts` (or wherever the init command handler lives)
  - Tests: Integration test that runs the full init flow on a fixture project with enforced constraints and verifies both `.reins/hooks/` scripts and `.claude/settings.json` are produced
  - Done when: `reins init` produces hook scripts and `settings.json` as part of its normal output; summary lines are printed; test passes
