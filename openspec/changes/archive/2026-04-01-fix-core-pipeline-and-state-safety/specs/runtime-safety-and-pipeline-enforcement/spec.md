## ADDED Requirements

### Requirement: Update SHALL diff project inputs instead of generated state
The system SHALL compute incremental update eligibility from project inputs that influence scanning and constraint generation, not from `.reins/` generated artifacts alone. After a successful update write, the persisted manifest baseline MUST reflect the post-update state used for the next comparison.

#### Scenario: Source file change triggers update
- **WHEN** a user modifies a project source or configuration file that participates in scanning or constraint generation and then runs `reins update`
- **THEN** the system MUST detect the change and proceed with regeneration or merge evaluation

#### Scenario: Generated artifact write does not become the only update signal
- **WHEN** `reins update` writes `.reins/constraints.yaml` successfully
- **THEN** the manifest saved for the next run MUST represent the new baseline instead of preserving the pre-write manifest

### Requirement: Pipeline SHALL enforce QA and evaluation gates
The pipeline SHALL execute QA commands from generated pipeline configuration and MUST fail when required QA commands fail or when required evaluation gates for the active profile are not satisfied.

#### Scenario: QA commands are present
- **WHEN** generated pipeline configuration contains `pre_commit` or `post_develop` commands
- **THEN** the QA stage MUST execute those commands in order and mark the stage failed if any command fails

#### Scenario: Evaluation gate fails
- **WHEN** the active profile requires evaluation conditions that are not met during the verification stage
- **THEN** the pipeline MUST return failure even if the underlying bridge invocation returned successfully

### Requirement: Dry-run SHALL not mutate workspace state
Commands advertised as dry-run MUST avoid writing `.reins` artifacts, settings, manifests, snapshots, or any other project files.

#### Scenario: Init dry-run
- **WHEN** a user runs `reins init --dry-run`
- **THEN** the command MUST report planned outputs without creating or modifying files under `.reins/`, `.claude/`, or adapter output locations

### Requirement: CLI safety flags SHALL match implemented behavior
Documented CLI flags for overwrite, diff preview, and auto-apply MUST either be implemented according to their user-facing description or removed from the command surface and help text.

#### Scenario: Unsupported safety flag is not exposed
- **WHEN** a command does not implement a documented safety option
- **THEN** the CLI MUST NOT advertise that option as available behavior

#### Scenario: Auto-apply uses schema-backed semantics
- **WHEN** a user runs `reins update --auto-apply`
- **THEN** the command MUST apply only changes supported by the documented schema and CLI contract, and MUST NOT depend on undeclared constraint fields

### Requirement: State writes SHALL fail safe and restore exactly
The system MUST avoid silent destructive overwrites of user-managed files and MUST restore captured snapshot state exactly for all captured paths.

#### Scenario: Malformed settings file
- **WHEN** `.claude/settings.json` exists but cannot be parsed as valid JSON during hook/settings generation
- **THEN** the command MUST stop with a clear error instead of overwriting the file with a reset configuration

#### Scenario: Snapshot restore removes missing captured files
- **WHEN** a snapshot is restored and a captured file or captured-directory file is absent from the snapshot contents
- **THEN** the restore process MUST remove that path from the current `.reins` state so the restored state matches the snapshot exactly
