import type { Workflow } from './types.js';

export const learnWorkflow: Workflow = {
  id: 'reins-learn',
  name: 'reins-learn',
  description: 'Read execution history, surface recurring violations, and propose constraint changes.',
  body: `Look at what Reins has observed in this project and propose changes to
\`.reins/constraints.yaml\` based on real history. The CLI does the
statistical heavy lifting; *you* (the IDE-LLM) make the judgment calls
about what to change.

---

## Step 1 — Pull the analysis

Run this in the repo root via the Bash tool:

\`\`\`bash
reins analyze --json
\`\`\`

Parse the JSON. The shape is:

\`\`\`ts
{
  metrics: { successRate, avgDuration, avgRetries },
  patterns: {
    recurringErrors:    [{ error, frequency, suggestedConstraint }],
    ignoredConstraints: [{ rule, violationRate, suggestion: 'strengthen' | 'remove' }],
    efficientPatterns:  [{ pattern, speedup }],
  },
  suggestedActions: [
    { type: 'add_constraint',    rule, severity, confidence },
    { type: 'remove_constraint', rule, reason, confidence },
    { type: 'create_skill',      content, confidence },
    { type: 'add_hook',          constraintId, confidence },
  ],
}
\`\`\`

If \`suggestedActions\` is empty, tell the user "No changes suggested
yet — keep coding and run \`/reins-learn\` again later." and stop.

---

## Step 2 — Decide which actions to apply

For each suggested action, decide:

- **High confidence (≥ 80) and unambiguous** → propose to apply
  immediately, but still show the user the diff before writing.
- **Medium confidence (50-79)** → present to the user with the evidence
  and ask whether to apply, modify, or skip.
- **Low confidence (< 50)** → mention briefly but don't propose changes.
  Surface them as "things to watch".

Use the **AskUserQuestion tool** with explicit options when asking the
user to choose (apply / modify / skip).

---

## Step 3 — Apply chosen actions

For each action the user accepts:

- \`add_constraint\` → invoke the same logic as \`/reins-add-constraint\`:
  validate the rule, derive id/scope/severity, and append to
  \`.reins/constraints.yaml\`. Cite the specific recurring error or
  ignored-constraint frequency that justifies it inside the \`rule\` text.
- \`remove_constraint\` → delete the constraint from \`constraints.yaml\`.
  Tell the user the violation rate or reason.
- \`add_hook\` → set \`enforcement.hook: true\` on the constraint with the
  given id, leaving \`hook_mode\` at the project default.
- \`create_skill\` → out of scope for this workflow. Tell the user "skill
  creation lives in \`/reins-skill-create\`" (if you have it) or just
  describe the suggested skill content for them to act on later.

Edit the YAML in place — preserve indentation, comments, and unrelated
fields.

---

## Step 4 — Verify

After all edits:

1. Run \`reins status\` to confirm the YAML still parses.
2. Run \`reins test\` to confirm hooks are still healthy.

If either fails, restore the file via git and tell the user what broke.

---

## Step 5 — Report

Tell the user:
- Which actions you **applied**, with one-line evidence each.
- Which actions you **deferred**, with the reason.
- Current \`successRate\` and \`avgDuration\` so they can track trend over
  time.

---

## Hard rules

- Do not make up actions that aren't in the JSON output. If the analysis
  is empty, the answer is "nothing to do yet" — that's fine.
- Do not auto-apply a change without showing the user what's about to
  happen, even if the confidence is 99.
- Recurring errors in \`.reins/logs/\` are not always Reins's fault —
  some indicate the user's *code* needs fixing, not the constraints.
  Distinguish between the two when explaining to the user.
`,
};
