## Approach

Implement the full OBSERVE → ANALYZE → LEARN → CONSTRAIN pipeline as four focused sub-modules under `src/learn/`, each with a single responsibility. The pipeline is triggered automatically by the `SessionEnd` hook. High-confidence actions are applied immediately; medium-confidence actions generate user-facing prompts; low-confidence signals are written to a pending log for future accumulation. All automated changes are reversible via the changelog.

## Architecture

**Observer** (`learn/observer.ts`):
- Exports `recordObservation(sessionId: string, data: Partial<ExecutionObservation>): void`
- Reads pipeline runner execution log for the session (`exec-YYYY-MM-DD-NNN.yaml`)
- Merges hook trigger records from `.reins/logs/hook-health.yaml`
- Merges evaluation results from the evaluator output
- Writes complete `ExecutionObservation` to `.reins/logs/executions/exec-<id>.yaml`
- Fields: `sessionId`, `taskDescription`, `timestamp`, `duration`, `outcome`, `agentsUsed[]`, `toolsUsed[]`, `filesModified[]`, `testsRun`, `errors[]`, `retries[]`, `humanInterventions[]`, `constraintViolations[]`, `reviewFeedback[]`, `learnings[]`

**Analyzer** (`learn/analyzer.ts`):
- Exports `analyze(observations: ExecutionObservation[]): AnalysisResult`
- Loads all `exec-*.yaml` files from the last N sessions (configurable window, default: 30 days)
- Computes metrics: `avgTaskDuration`, `successRate`, `avgRetries`, `humanInterventionRate`
- Detects patterns via frequency counting:
  - `recurringErrors`: errors appearing >= 3 times → `suggestedConstraint`
  - `recurringInterventions`: interventions appearing >= 3 times → `suggestedAutomation`
  - `efficientPatterns`: tool sequences that correlate with faster success → `suggestedSkill`
  - `ignoredConstraints`: rules violated >= 50% of applicable sessions → `'strengthen' | 'remove'`
  - `agentEfficiency`: per-agent `successRate` and `avgDuration`
- Produces `Action[]` with typed variants and `confidence` scores

**Learner** (`learn/learner.ts`):
- Exports `applyLearnings(actions: Action[]): LearnerReport`
- Partitions actions by confidence: `>85` auto, `60-85` suggest, `<60` log
- Auto-apply path: calls `ConstraintUpdater.apply(action)` or `writeSkill(draft)` directly
- Suggest path: writes a `pending-actions.yaml` entry and emits a user-facing message via stdout
- Log path: appends to `.reins/logs/low-confidence.yaml` for future accumulation
- Manages skill lifecycle state transitions (see Skill Lifecycle below)

**Scorer** (`learn/scorer.ts`):
- Exports `scoreSkillCandidate(candidate: SkillDraft): number`
- Deterministic weighted scoring matching module ⑧ table:
  - Base: 50
  - Contains file paths: +15
  - Contains error messages: +15
  - High-value keywords (error, fix, workaround, failed, avoid, broken, root cause, regression): +5 each, cap +20
  - Repeat occurrences in logs: +10 each, cap +30
  - Solution body > 100 chars: +10
  - Generic phrases (try again, check docs, read the docs, see documentation): -15
  - Content < 50 chars total: -20
  - No trigger pattern defined: -25
- Returns integer 0-100; candidates below 70 are not promoted to skill suggestions

**Promoter** (`learn/promoter.ts`):
- Exports `updateLifecycle(skill: SkillLifecycle): SkillLifecycle`
- Reads quality score and trend; applies transitions:
  - Draft (50) + score >= 70 after use → Active
  - Active (70) + usageCount >= 5 + successRate >= 80% → Verified
  - Verified (90) + score >= 90 → Promoted
  - Any state + score drops to <= 30 → Declining
  - Declining + score drops to 0 → Archived (move file to `.reins/skills/archive/`)
- Persists updated `SkillLifecycle` metadata alongside the skill file

**Constraint Updater** (`learn/constraint-updater.ts`):
- Exports `applyActions(actions: Action[], projectRoot: string): void`
- Loads `constraints.yaml` via existing constraint loader
- For each action:
  - `update_constraint`: mutates the rule value
  - `create_skill`: writes YAML to `.reins/skills/auto/<name>.yaml`
  - `add_hook`: appends hook entry to `.reins/hooks/` config
  - `remove_constraint`: sets `deprecated: true` + `deprecationReason` (never deletes)
- Calls existing `recompileConstraints()` to regenerate target formats (CLAUDE.md, AGENTS.md)
- Appends changelog entry to `.reins/logs/constraint-changelog.yaml` with timestamp, action type, confidence, and the before/after diff

**Weekly report aggregator** (in `learn/analyzer.ts`):
- After analysis, if the report for the current week does not exist, write `.reins/reports/weekly-YYYY-WNN.yaml`
- Report fields: `period`, `summary.total_tasks`, `summary.success_rate`, `summary.avg_duration`, `top_violations[]`, `agent_efficiency[]`, `skill_effectiveness[]`

**SessionEnd hook wiring**:
- `.reins/hooks/session-end.sh` calls `reins learn --auto` after the existing staleness check
- `reins learn --auto` is a new CLI subcommand that runs Observer → Analyzer → Learner pipeline non-interactively

## Key Decisions

- **Four separate modules over a monolithic learner**: Each module can be tested independently and replaced. The Observer has no dependency on the Analyzer; the Analyzer has no dependency on the Learner. Confidence thresholds are enforced only in the Learner, not scattered across modules.
- **Confidence thresholds at 85/60, not 90/70**: The 85 threshold for auto-action is deliberately conservative — the cost of a wrong automated constraint change is high. The 60 threshold for suggestions is more permissive because user review is still in the loop.
- **Deprecation over deletion for constraints**: Deleted constraints cannot be audited; deprecated constraints carry a reason and remain visible in the changelog. Teams can hard-delete deprecated rules after review.
- **Weekly reports on analysis, not a separate cron**: Tying report generation to the analysis run avoids a separate scheduler dependency and ensures reports reflect the same data window the Analyzer used.
- **`reins learn --auto` as an explicit CLI command**: Hooks invoke a CLI command, not a module function directly. This means the pipeline can be run manually for debugging and the hook is a one-liner.

## File Structure

```
src/learn/
├── observer.ts                     # new: ExecutionObservation capture and persistence
├── analyzer.ts                     # new: pattern detection, AnalysisResult, weekly reports
├── learner.ts                      # new: confidence-gated action execution
├── scorer.ts                       # new: deterministic skill quality scoring
├── promoter.ts                     # new: skill lifecycle state machine
└── constraint-updater.ts           # new: writes actions back to constraints.yaml

src/cli.ts                          # extended: adds `reins learn --auto` subcommand

.reins/
├── logs/
│   ├── executions/
│   │   └── exec-YYYY-MM-DD-NNN.yaml   # per-session ExecutionObservation
│   ├── constraint-changelog.yaml       # append-only log of automated constraint changes
│   └── low-confidence.yaml            # signals awaiting more data
├── skills/
│   ├── auto/                          # auto-created draft skills
│   └── archive/                       # archived skills (score dropped to 0)
└── reports/
    └── weekly-YYYY-WNN.yaml           # weekly aggregated analysis reports
```
