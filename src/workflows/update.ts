import type { Workflow } from './types.js';

export const updateWorkflow: Workflow = {
  id: 'update',
  name: 'update',
  description: 'Refresh constraints after major project changes — rescan, merge, surface stale entries.',
  body: `Reins's constraints get stale as the project evolves: directories get
renamed, package managers swap, modules move. This workflow refreshes
\`.reins/constraints.yaml\` to match what the repo actually looks like
right now, and surfaces any constraints whose grounding no longer holds.

---

## Step 1 — Rescan

Run in the repo root:

\`\`\`bash
reins update
\`\`\`

This rescans the repo, builds a fresh manifest, diffs it against the
previous one, and merges incoming auto-detected constraints with the
existing ones in \`constraints.yaml\`. The CLI prints what changed.

If the CLI says "Nothing changed", the manifest is current. Tell the
user "No structural changes since last update" and stop.

---

## Step 2 — Read what changed

Read the updated \`.reins/constraints.yaml\`. Compare against your memory
of what was there before (or use \`git diff .reins/constraints.yaml\`).

For each change:

- **Newly added constraints (\`source: auto\`)**: scrutinize them with
  the same rigor as Phase 0 of \`/reins:setup\`. Auto-generated rules are
  guesses. Keep the load-bearing ones, delete the rest.
- **Modified constraints**: usually a scope path got more accurate. Skim
  to confirm.
- **Removed constraints**: the CLI dropped them because their scope no
  longer exists. Confirm this is correct — sometimes a directory move
  means the rule should be re-anchored, not deleted.

---

## Step 3 — Find stale manual constraints

For each constraint with \`source: manual\` in \`constraints.yaml\`:

1. If \`scope\` is a file or directory path, check it still exists.
2. If \`scope\` is a glob, check the glob still matches at least one file.
3. If the rule cites a commit hash, run \`git log -1 <hash>\` to confirm
   the commit still exists in history.
4. If the rule references a file path inside the rule text, check that
   path still exists.

For each stale constraint, show the user:
- The constraint id and rule
- What's stale (missing path, commit, etc.)
- A proposed action: **re-anchor to a new path**, **delete**, or **keep**

Use **AskUserQuestion** to let the user pick.

---

## Step 4 — Re-validate \`pipeline.pre_commit\`

Read \`pipeline.pre_commit\`. For each command:

1. Quickly verify the binary or subcommand still exists in this repo.
   (E.g. for \`pnpm lint\`, check \`package.json\` has a \`lint\` script.)
2. If the package manager changed (lockfile swap), the commands need
   updating — propose the new command and ask the user to confirm.

If anything looks broken, tell the user and offer to update — but don't
write the change without confirmation.

---

## Step 5 — Verify

After all edits:

1. Run \`reins status\` to confirm the YAML still parses.
2. Run \`reins test\` to confirm hooks are still healthy.

---

## Step 6 — Report

Summarize:
- Auto-detected constraints **added** / **removed** / **kept**
- Stale manual constraints handled (and how)
- Whether \`pipeline.pre_commit\` needed updates
- Final \`reins status\` count

---

## Hard rules

- Do not delete a manual constraint just because its scope path moved —
  re-anchoring is usually correct. Delete only when the rule itself is
  no longer applicable.
- Do not invent new project-specific constraints in this workflow. Use
  \`/reins:add-constraint\` for that.
- If \`reins update\` itself errors, do not patch around it — report the
  error to the user.
`,
};
