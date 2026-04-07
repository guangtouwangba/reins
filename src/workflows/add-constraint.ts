import type { Workflow } from './types.js';

export const addConstraintWorkflow: Workflow = {
  id: 'reins-add-constraint',
  name: 'reins-add-constraint',
  description: 'Add a new constraint to .reins/constraints.yaml from a natural-language rule.',
  body: `Add a new constraint to \`.reins/constraints.yaml\` based on what the user
describes. Reins itself never asks an LLM to do this — *you* are the LLM,
and you have the full project context the CLI doesn't.

---

## Step 1 — Get the rule

If the user already gave a rule in the slash command arguments, use it.
Otherwise use the **AskUserQuestion** tool to ask:

> "What rule do you want to add? Phrase it as 'must X' or 'don't X', and
> tell me where in the repo it applies."

---

## Step 2 — Validate the rule earns its place

Reject (and tell the user why) if any of these is true:

1. **Not phrased as a constraint.** "To run tests, do X" is operational
   how-to, not a rule. Suggest putting it in \`AGENTS.md\` instead.
2. **Generic best practice.** "Use TypeScript strictly", "follow DDD" —
   any AI already knows this. Don't add it.
3. **Already enforced by \`pipeline.pre_commit\`.** Read
   \`.reins/constraints.yaml\` and check the \`pre_commit\` array. If a lint
   command would catch this, the command is the source of truth — don't
   duplicate it as a constraint.
4. **No grounding.** Ask the user for *evidence*: a file path, a commit
   hash, a past incident, a config override. Without grounding, the
   constraint is just an opinion and will be ignored.

If any check fails, explain to the user and stop. Don't write the file.

---

## Step 3 — Determine fields

From the user's description, derive:

- **\`id\`**: kebab-case, descriptive, ~3-5 words. Must be unique within
  \`constraints.yaml\` — read the file and check existing ids.
- **\`scope\`**: a glob path or directory the rule applies to. Use the
  narrowest scope that's correct. If global, use \`global\`.
- **\`severity\`**: be strict, default to \`important\`.
  - \`critical\`: past incident or CI/production breaker. You can cite a
    commit or describe a concrete failure mechanism.
  - \`important\`: project convention an agent will guess wrong on first
    try. Most rules land here.
  - \`helpful\`: soft preference. Almost-no-cost to remove.
- **\`source\`**: \`manual\` (for things the user added directly).
- **\`rule\`**: rewrite the user's prose into a single clear sentence
  starting with "must" or "don't". Include the grounding evidence inline
  (file path, commit hash) so future readers know why.

---

## Step 4 — Write to constraints.yaml

1. Read \`.reins/constraints.yaml\`.
2. Append the new constraint to the \`constraints:\` array. Preserve YAML
   formatting and indentation of surrounding entries.
3. Write the file back.

Use a YAML-aware edit. Do **not** rewrite the whole file from scratch —
that risks losing comments and reordering unrelated fields.

---

## Step 5 — Verify

1. Run \`reins status\` — confirm the new constraint shows up in the list
   and the YAML still parses.
2. Run \`reins test\` — confirm hooks still report healthy.

If either fails, restore the file (you can use \`git checkout
.reins/constraints.yaml\`) and tell the user what went wrong.

---

## Output

Tell the user:
- The exact YAML block you added.
- The severity you chose and why.
- Whether \`reins status\` and \`reins test\` passed.
- Any constraints you noticed are now duplicated by this one (offer to
  remove them).
`,
};
