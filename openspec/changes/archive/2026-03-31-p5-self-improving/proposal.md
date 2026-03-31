## Why

Phase 3-4 built the Observer and a manual `/reins learn` extraction path, but the system still requires human initiation for every improvement. The full OBSERVE → ANALYZE → LEARN → CONSTRAIN loop needs to close automatically: recurring errors should become constraints, efficient patterns should become skills, and constraint improvements should be written back to `constraints.yaml` without manual steps.

## What Changes

- Add `src/learn/observer.ts`: implements `ExecutionObservation` interface — captures agents used, tools used, files modified, test results, errors, retries, human interventions, constraint violations, review feedback, and learnings per session
- Add `src/learn/analyzer.ts`: implements `AnalysisResult` with metrics (avgTaskDuration, successRate, avgRetries, humanInterventionRate) and pattern detection (recurringErrors, recurringInterventions, efficientPatterns, ignoredConstraints, agentEfficiency); produces typed `Action[]` with confidence scores
- Add `src/learn/learner.ts`: confidence-gated execution — >85 auto-applies, 60-85 suggests to user, <60 logs only; manages full skill lifecycle (Draft 50 → Active 70 → Verified 90 → Promoted 100 / Declining 30 → Archived 0)
- Add `src/learn/scorer.ts`: quality scoring for skill candidates — base 50, +15 file paths, +15 errors, +5/keyword (max +20), +10/repeat (max +30), -15 generic, -20 short, -25 no trigger
- Add `src/learn/promoter.ts`: tracks skill quality trends and executes lifecycle transitions; auto-archives skills that drop below score 30
- Add `src/learn/constraint-updater.ts`: writes approved actions back to `constraints.yaml`, recompiles to target formats, appends structured changelog entries
- Aggregate execution observations into weekly reports at `.reins/reports/weekly-YYYY-WNN.yaml`
- Wire `SessionEnd` hook to trigger the analyze → learn → constrain pipeline automatically

## Capabilities

### New Capabilities

- `execution-observer`: Structured capture of every session's agent usage, tool calls, errors, retries, interventions, and constraint violations into `.reins/logs/executions/exec-YYYY-MM-DD-NNN.yaml`
- `pattern-analyzer`: Batch analysis of accumulated execution logs to detect recurring errors (→ constraint candidates), recurring interventions (→ hook/automation candidates), efficient patterns (→ skill candidates), and ignored constraints (→ strengthen or remove)
- `confidence-gated-learner`: Three-tier execution of suggested improvements: auto-apply at >85 confidence, prompt user at 60-85, log-only below 60
- `skill-lifecycle-manager`: Automated promotion and demotion of skills through Draft → Active → Verified → Promoted and Declining → Archived stages based on quality score trajectory
- `skill-quality-scorer`: Deterministic scoring of skill candidates using the weighted factor table from module ⑧
- `constraint-updater`: Writes learned improvements back to `constraints.yaml`, recompiles all target formats, and appends a human-readable changelog entry for every automated change
- `weekly-report-aggregator`: Produces `.reins/reports/weekly-YYYY-WNN.yaml` summarizing task outcomes, top violations, agent efficiency, and skill effectiveness over the previous 7 days

### Modified Capabilities

- `SessionEnd hook`: Now triggers the full analyze → learn → constrain pipeline in addition to the existing lightweight staleness check

## Impact

- Pipeline Runner execution logs (`p2-pipeline-runner`) are the primary input; this change adds schema requirements to that log format
- Knowledge capture (`p3-knowledge-capture`) feeds learnings into the observer's `learnings[]` field
- `constraints.yaml` is now written by automation; teams should commit constraint file changes through the normal git workflow to preserve review history
- Auto-created skills land in `.reins/skills/auto/` which should be reviewed periodically and promoted or archived
- Weekly reports add a new directory `.reins/reports/` to the project structure
