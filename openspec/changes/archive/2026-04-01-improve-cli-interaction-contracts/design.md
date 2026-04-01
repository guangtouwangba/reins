## Context

This change hardens the CLI interaction layer described by `modules/01-cli-state.md` and the user-facing workflow narrative in `modules/05-pipeline-runner.md`. The current project has a reasonably broad command surface, but the interaction model is inconsistent across four places users rely on together:

- `README.md` examples and feature framing
- Commander help output in `src/cli.ts`
- command runtime behavior in `src/commands/*`
- recovery and empty-state messaging during failure paths

The main UX problem is not lack of features by itself, but that the interface teaches users unsupported or partial behaviors as if they were production-ready. That creates trust breaks during onboarding and makes error recovery feel unreliable.

This change stays inside the existing Node.js + Commander CLI architecture. It does not add external dependencies or introduce a new presentation layer. It standardizes how command capability, partial implementation, and next-step guidance are represented.

Relevant existing structures:

- The `Command` registration in `src/cli.ts` is the canonical discoverability surface.
- Command handlers in `src/commands/*.ts` own empty states, recovery messages, and action summaries.
- Snapshot-based flows in `src/commands/rollback.ts` are the highest-risk interactive path and need stronger operator feedback.

## Goals / Non-Goals

**Goals:**
- Ensure help text, README examples, and runtime behavior describe the same supported command surface.
- Define a consistent pattern for unsupported or partial commands so users receive explicit, actionable guidance.
- Improve empty-state and error-state microcopy to always include a next step.
- Add safer interaction around rollback and similar high-risk flows.
- Make status and test output more trustworthy by avoiding recommendations that overclaim confidence.

**Non-Goals:**
- Implement the full `develop` pipeline.
- Redesign the overall information architecture of Reins beyond CLI interaction text and flow.
- Add telemetry, analytics, or interactive TUI screens.
- Expand status into a dashboard-style reporting feature.

## Decisions

### 1. Treat `src/cli.ts` as the contract surface

The visible command registry must only expose options and actions that are actually supported. If a feature is partial, the CLI should either hide it or mark it explicitly as preview/unavailable in a way that matches runtime behavior.

Alternatives considered:
- Leave aspirational commands in help output as roadmap hints: rejected because it misleads first-time users.
- Move roadmap messaging only into README: rejected because users primarily trust `--help` during operation.

### 2. Standardize unsupported-command responses

For commands that remain intentionally unavailable, runtime output should follow one pattern: state that the command is unavailable, explain the current limitation, and provide a concrete alternative or next step. This is better than silent stubs or generic usage text.

Alternatives considered:
- Keep plain “not yet implemented” messages: rejected because they strand the user.

### 3. Make every dead end actionable

Empty states and failure states should include what the user can do next in the current workspace, not just what is missing. Examples: init prerequisites, missing hooks, invalid rollback target, malformed configuration, and broken-hook follow-up.

Alternatives considered:
- Rely on terse Unix-style output: rejected because Reins is positioned as a guided workflow tool, not a low-level utility.

### 4. Add safety affordances to rollback flows

Rollback should summarize what will happen before mutating state and ask for confirmation in interactive mode. Non-interactive rollback with `--to` should still print a clear preflight summary and final restore summary.

Alternatives considered:
- Keep raw numbered prompt flow: rejected because rollback is a state-changing operation with recovery implications.

### 5. Downgrade low-confidence recommendations to observational output

Status suggestions should only appear when backed by meaningful evidence. Cases like “zero violations” should be phrased as observation or omitted rather than presented as strong recommendation.

Alternatives considered:
- Keep all heuristic suggestions visible: rejected because low-signal advice reduces trust in the whole interface.

## Risks / Trade-offs

- [Reducing exposed commands/options may make the product look smaller] → Mitigate by preferring truthful scope over aspirational breadth.
- [More verbose recovery copy can feel noisy] → Mitigate by keeping messages short, structured, and action-oriented.
- [Rollback confirmations add friction] → Mitigate by limiting them to state-changing paths and keeping `--to` efficient.
- [README alignment work may expose additional implementation gaps] → Mitigate by updating docs as part of the same change instead of deferring documentation debt.

## Migration Plan

1. Audit `src/cli.ts`, `README.md`, and command handlers for mismatched capabilities.
2. Remove, relabel, or explicitly gate unsupported options/actions.
3. Standardize empty-state, failure-state, and unsupported-feature copy across commands.
4. Improve rollback interaction with preview and confirmation semantics.
5. Update tests to assert help output and recovery messaging.
6. Re-run command-level checks for `--help`, missing-state flows, and rollback behavior.

## Open Questions

- Should `develop` remain visible as a roadmap placeholder with an explicit preview label, or be hidden entirely until implementation exists?
- Should the README keep future-facing examples if they are clearly marked as upcoming, or should it be limited strictly to working commands?
