import type { Workflow } from './types.js';

export const shipWorkflow: Workflow = {
  id: 'ship',
  name: 'ship',
  description: 'Batch-run `reins ship` over the todo features in .reins/features/ and report results. Delegates to the CLI — never spawns parallel agents here.',
  body: `Kick off the \`reins ship\` batch runner and report back what it did.
This workflow is a thin shell over the CLI — \`reins ship\` is already
the orchestrator, with its own attempt budget, dependency planner,
headless worker spawning, and lock file. Your job is **not** to
re-implement any of that. You gather the user's intent, run the CLI
once, and interpret the results.

If the user wants to iterate on a single stuck feature interactively,
use \`/reins:ship-here\` instead. This workflow is for unattended
batch runs.

---

## Step 1 — Show the current queue

Run \`reins feature list\` via Bash. Show the user the counts by status
(todo / in-progress / done / blocked). If there are zero \`todo\`
features, tell the user:

> "Nothing to ship. The queue has no features in status \`todo\`. Use
> \`/reins:feature-new\` to draft one, or \`reins feature set-status
> <id> todo\` to promote a draft."

…and stop.

## Step 2 — Gather options (optional)

If the slash command already included flags (e.g.
\`/reins:ship --dry-run\`, \`/reins:ship --only 001-foo,002-bar\`),
pass them through verbatim and skip this step.

Otherwise, use **AskUserQuestion** to collect:

1. **Scope** — "Run all \`todo\` features, or a specific subset?"
   Options: \`all\`, \`subset\` (then ask for a comma-separated id
   list), \`dry-run\` (plan only, no execution).
2. **Parallelism** — "Run serially (1 feature at a time) or let the
   planner pick an order based on \`depends_on\`?"
   Options: \`serial\` (\`--parallel 1\`), \`planner\` (default).
3. **Commit behavior** — "Auto-commit after each feature passes
   verify, or leave commits for you to review?"
   Options: \`auto-commit\` (default), \`no-commit\` (\`--no-commit\`).

Only ask what's genuinely ambiguous. For a quick "ship everything"
request, skip straight to Step 3 with defaults.

## Step 3 — Run the CLI

Invoke via Bash with the flags you collected:

\`\`\`bash
reins ship [--only <ids>] [--dry-run] [--parallel <n>] [--no-commit]
\`\`\`

**Do not use \`run_in_background\`.** Let the command stream output
into your tool result so you can read it. \`reins ship\` may take a
while — that's expected. Do not cancel early just because it's slow.

**Do not spawn any \`claude -p\` or \`Task\` agents from this
workflow.** The CLI already spawns headless workers internally. Your
job is to watch and report, not to duplicate orchestration.

## Step 4 — Interpret the results

When \`reins ship\` exits, look at:

- **Exit code** — non-zero means at least one feature ended in
  \`blocked\` or the run aborted.
- **\`.reins/runs/<timestamp>/run.json\`** (if the CLI printed a path,
  read it) — per-feature status, attempt counts, failure objects.
- **\`reins feature list\`** — the post-run queue state.

Summarize for the user:

1. How many features went \`done\`, how many \`blocked\`, how many
   untouched.
2. For each \`blocked\` feature, show the \`last_failure.stage\` and a
   one-line excerpt of the error so they can decide what to do next.
3. If every feature shipped cleanly, say so and tell them to review
   the commits (one per feature by default).

## Step 5 — Next steps for blocked features

If anything is blocked, recommend:

- \`/reins:ship-here <id>\` — drop into the feature in this session
  and debug it interactively. Fastest path when the failure is
  subtle.
- \`reins feature set-status <id> todo\` — re-queue after fixing the
  underlying issue (dependency, spec ambiguity, missing env var).
- Read \`.reins/runs/<timestamp>/<id>/\` — the full per-attempt logs
  live there. Point the user at the exact file.

Never auto-retry a blocked feature from this workflow. The whole
point of the block is that the attempt budget was exhausted — more
attempts without a real fix are just more noise.

---

## Hard rules

- Never invoke \`claude -p\` or spawn sub-agents. \`reins ship\`
  already does that.
- Never modify \`.reins/features/*.md\` from this workflow. The CLI
  owns status transitions and frontmatter.
- Never pass \`--max-attempts\` higher than the project default
  without the user explicitly asking. Raising the budget masks real
  failures.
- Never commit anything manually in this workflow. If auto-commit is
  off, leave it off — the user will review diffs themselves.
`,
};
