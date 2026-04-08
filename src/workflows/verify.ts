import type { Workflow } from './types.js';

export const verifyWorkflow: Workflow = {
  id: 'verify',
  name: 'verify',
  description: 'Run the pipeline.pre_commit verification chain on demand and explain any failures.',
  body: `Run the verification commands Reins enforces at Stop time, and explain
any failures so the user can fix them before the gate-stop hook blocks
their next turn.

---

## Step 1 — Read pipeline.pre_commit

Read \`.reins/constraints.yaml\` and extract the \`pipeline.pre_commit\`
array. If it's empty, tell the user:

> "No verification commands configured. Run \`/reins:setup\` first to
> populate \`pipeline.pre_commit\`."

…and stop.

---

## Step 2 — Run each command

For each command in \`pipeline.pre_commit\`, in order:

1. Print the command you're about to run.
2. Run it via the Bash tool with \`cwd\` = repo root. The commands already
   embed any \`cd subdir &&\` they need.
3. Capture stdout + stderr + exit code.
4. If it failed, **stop** — do not run remaining commands. The gate-stop
   hook short-circuits on the first failure too, so this matches what
   the user will see at Stop time.

Use the **TodoWrite tool** to track progress through the commands.

---

## Step 3 — If everything passed

Tell the user:

> "✓ All N pre_commit commands passed. The gate-stop hook will not block
> your next turn."

Then stop.

---

## Step 4 — If something failed

For the failing command:

1. Print the command, exit code, and the last ~30 lines of output.
2. Identify the **root cause**:
   - Lint error? Show the file and line.
   - Type error? Show the type mismatch.
   - Format failure? Tell the user which formatter and how to apply.
3. Propose **two paths forward**:
   - **(a) Fix the code** — describe the smallest edit that would make
     the command pass. If you're confident, offer to make the edit.
   - **(b) Fix the constraint** — if the failure is because the command
     itself is wrong (e.g. lint config moved, command renamed in
     package.json), propose updating \`pipeline.pre_commit\` instead. Use
     \`/reins:setup\` semantics to validate the new command.
4. Wait for the user's decision before doing anything destructive.

---

## Hard rules

- **Never edit code without telling the user first.** This is a verify
  workflow, not an autofix workflow.
- **Never modify \`.reins/constraints.yaml\`** unless the user explicitly
  picks path (b).
- **Never bypass the failure** by suggesting \`--no-verify\`,
  \`HUSKY=0\`, or skipping commands. Those are forbidden by the project's
  permissions.deny list and will be rejected by Claude Code anyway.
`,
};
