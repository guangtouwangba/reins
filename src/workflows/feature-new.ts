import type { Workflow } from './types.js';

export const featureNewWorkflow: Workflow = {
  id: 'feature-new',
  name: 'feature-new',
  description: 'Interactively draft a new feature file under .reins/features/ for the ship queue.',
  body: `Draft a new feature for the \`reins ship\` queue. This workflow gathers
intent and acceptance criteria from the user interactively, then writes a
properly-formatted feature file at \`.reins/features/<id>.md\`.

The resulting file stays in \`status: draft\` until the user explicitly
transitions it to \`todo\` — that's deliberate, so \`reins ship\` doesn't
race to pick up half-written specs.

---

## Step 1 — Gather the core information

Use the **AskUserQuestion tool** (one question at a time, open-ended) to
collect each piece below. If the user provided any of these inline in
their slash command argument, skip the corresponding question.

1. **Short title**: "What's a short name for this feature? (≤ 60 chars)"
2. **Intent**: "In one or two sentences, what does this feature do and
   why?"
3. **Acceptance criteria**: "List 3-6 observable checks that prove this
   feature is done. One per line."
4. **Scope globs (optional)**: "Which files or directories should reins
   restrict this feature to? (Comma-separated globs, e.g.
   \`src/auth/**\`, \`app/frontend/src/pages/login/**\`. Leave blank for
   no scope lock.)"
5. **Backend contract (optional)**: "Any API endpoints or data contracts
   to describe? If not, skip."
6. **Browser test (optional but recommended)**: "Describe in plain
   English how a human would click through the browser to verify this
   feature. Leave blank for backend-only features."
7. **Dependencies (optional)**: "Does this feature depend on any other
   queued features completing first? List their ids."

## Step 2 — Derive a feature id

From the title, produce a kebab-case id with a 3-digit ordering prefix:

1. Read \`reins feature list\` to see what's already there.
2. Pick the next unused prefix number (001, 002, …).
3. Slug the title: lowercase, ASCII alphanumerics only, dashes between
   words, max 40 chars. E.g. "Add email login" → \`add-email-login\`.
4. Final id: \`<prefix>-<slug>\` (e.g. \`007-add-email-login\`).
5. Validate: the id must match \`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/\`
   and must NOT contain \`..\`. If generation produces an invalid id,
   ask the user for a manual override.

## Step 3 — Create the file

Run via Bash:

\`\`\`bash
reins feature new <id> --title "<short title>"
\`\`\`

The CLI creates \`.reins/features/<id>.md\` with a skeleton body and
\`status: draft\`.

## Step 4 — Fill in the body

Read the file you just created and **edit the body only** — do NOT
touch the frontmatter. The CLI owns frontmatter updates via
\`reins feature set-status\`.

Replace each placeholder section with the user's input from Step 1:

- \`## What\` → the intent prose
- \`## Acceptance\` → a markdown checklist, one \`- [ ]\` per item
- \`## Backend contract\` → fill in if provided, otherwise delete the
  section
- \`## Browser test\` → fill in if provided, otherwise delete the
  section
- \`## Notes\` → leave empty (ship runner appends to this)

If the user provided \`depends_on\` or scope globs in Step 1, they go
in the frontmatter. Use \`reins feature new ... --force\` with a
re-created body, OR edit the frontmatter via this exact pattern (no
other frontmatter fields should be touched):

Read the file, find the \`depends_on: []\` and \`scope:\` lines, edit
them, write back. Do NOT use \`reins feature set-status\` for this —
it only handles status transitions.

## Step 5 — Verify

1. Run \`reins feature show <id>\` — confirm the content looks right.
2. Do NOT transition to \`todo\` automatically. Print this to the user:

   > Feature drafted as \`.reins/features/<id>.md\` (status: draft).
   > Review the file, then run:
   >
   >     reins feature set-status <id> todo
   >
   > to queue it for \`reins ship\`.

## Hard rules

- Never skip the AskUserQuestion round for \`Intent\` or \`Acceptance\`
  — a feature without those is useless.
- Never auto-transition from draft to todo. The user must see the draft
  first.
- Never commit the new feature file on the user's behalf.
- If any Bash command fails, stop and surface the error. Do not
  hand-write the file as a fallback — use \`reins feature new\` so the
  CLI enforces id validation.
`,
};
