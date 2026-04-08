/**
 * A workflow is a slash command that ships into the user's project at init
 * time. The CLI never runs the body itself — it just writes the file. The
 * user's IDE (Claude Code, Cursor, etc.) reads the file and executes the
 * instructions when the user types the slash command.
 *
 * Workflows are the project's *opinionated* operating procedures: how to
 * configure constraints, how to add a new rule, how to verify a change, how
 * to learn from past violations. They live in .claude/commands/reins/ (and
 * equivalents for other tools) so the IDE-LLM can run them with full project
 * context, instead of the CLI trying to spawn its own LLM.
 */
export interface Workflow {
  /** Slash command id — used as the filename. E.g. "setup". */
  id: string;
  /** Display name shown in the IDE command palette. */
  name: string;
  /** One-line description shown next to the name. Keep under ~120 chars. */
  description: string;
  /** The instruction body the IDE-LLM follows. Markdown. */
  body: string;
}
