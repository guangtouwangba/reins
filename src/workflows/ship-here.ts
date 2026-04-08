import type { Workflow } from './types.js';

export const shipHereWorkflow: Workflow = {
  id: 'ship-here',
  name: 'ship-here',
  description: 'Implement a single feature in the current IDE session (foreground, no headless spawn). Debug-friendly alternative to `reins ship`.',
  body: `Work on a single feature from \`.reins/features/\` **in this very IDE
session** — no headless \`claude -p\` subprocess, no parallel worktrees,
no auto-commit. This workflow exists as a debugging path for features
that get stuck when run through \`reins ship\`. It gives the user full
visibility into what you're doing and why each step succeeds or fails.

Use \`reins ship\` for batch unattended work. Use this workflow when:
- A feature went to \`blocked\` and you need to figure out why.
- The feature spec is ambiguous and you want the user to watch.
- You want to iterate interactively on the acceptance criteria.

---

## Step 1 — Get the feature id

If the user passed an id in the slash command arguments, use it.
Otherwise:

1. Run \`reins feature list\` via Bash.
2. Use **AskUserQuestion** with a list of non-done feature ids as
   preset options: "Which feature do you want to work on here?"

Validate: the id must exist as a file at \`.reins/features/<id>.md\`.

## Step 2 — Read the feature

Read \`.reins/features/<id>.md\` top to bottom. Pay attention to:

- \`## What\` — the user's intent
- \`## Acceptance\` — the observable checklist
- \`## Backend contract\` — API shape if present
- \`## Browser test\` — if present, you'll need to wire up Playwright
  manually at the end
- Frontmatter \`scope\` — the globs of files you're allowed to touch
- Frontmatter \`last_failure\` — if the feature was previously blocked,
  this contains the failure that exhausted its attempt budget. Read it
  first so you don't repeat the same mistake.

Also read \`.reins/constraints.yaml\` for the project constraints (the
critical + important ones) so you don't violate project rules while
implementing.

## Step 3 — Mark the feature in-progress

Run:

\`\`\`bash
reins feature set-status <id> in-progress
\`\`\`

This signals to any concurrent \`reins ship\` run (via the lock file)
and to the user's feature list view that this feature is being worked
on right now.

## Step 4 — Implement

Now do the actual work in THIS session, using your normal editing
tools (Edit, Write, MultiEdit). No shelling out to \`claude -p\`.

Show the user each file you touch. If they object to any change,
revert it and ask for guidance. You are not in autopilot mode —
interactivity is the whole point of this workflow.

Stay within the feature's \`scope\` globs. If you need to touch
something outside scope, stop and ask the user first. Don't silently
expand scope.

## Step 5 — Run verification layers

After the implementation is done, manually run the same verify chain
that \`reins ship\` would run:

1. **pre_commit** — Read \`pipeline.pre_commit\` from
   \`.reins/constraints.yaml\`. Run each command via Bash. Short-circuit
   on first failure and report it.
2. **feature_verify** — Same, but for \`pipeline.feature_verify\`.
3. **browser_verify** — Only if \`pipeline.browser_verify\` is
   configured AND the feature has a \`## Browser test\` section.
   Manually follow the browser test description (or generate a
   Playwright spec if the user wants). **Do NOT use the full
   \`reins ship\` browser verify pipeline — that's designed for
   headless runs.**

If any layer fails, show the output to the user and discuss what to
do. Don't automatically retry.

## Step 6 — Report, do NOT auto-commit

When everything passes:

> ✓ Feature \`<id>\` implemented and verified.
>
> Files changed: (list)
>
> Review the diff and commit when ready. To return the feature to the
> queue, run:
>
>     reins feature set-status <id> done
>
> Or if something's wrong, return it to todo:
>
>     reins feature set-status <id> todo

**Never run \`git commit\` yourself** in this workflow. The point of
ship-here is that the user is in the loop — they should see the diff
in their IDE's git view and decide when to commit.

## Hard rules

- Never spawn \`claude -p\` from this workflow. Everything happens in
  this IDE session.
- Never touch another feature's file. One feature per invocation.
- Never auto-transition status to \`done\` — the user decides.
- Never auto-commit. The whole point is interactive review.
- If you hit a real blocker, transition the feature to \`blocked\` via
  \`reins feature set-status <id> blocked\` and explain what you tried.
`,
};
