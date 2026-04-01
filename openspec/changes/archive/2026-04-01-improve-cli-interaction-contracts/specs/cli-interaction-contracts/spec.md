## ADDED Requirements

### Requirement: Command discovery SHALL match supported behavior
The CLI help output and README command documentation SHALL only describe commands, subcommands, options, and output formats that are currently supported, or SHALL explicitly mark them as unavailable or preview with matching runtime behavior.

#### Scenario: Unsupported option is not advertised as supported
- **WHEN** a command option or subcommand is not implemented in runtime behavior
- **THEN** the CLI help and README examples MUST either omit it or label it consistently as unavailable or preview

#### Scenario: Runtime behavior matches help contract
- **WHEN** a user runs a documented command from the help output or README
- **THEN** the observed runtime behavior MUST match the capability described to the user

### Requirement: Unsupported flows SHALL provide actionable guidance
When a command or action is intentionally unavailable or only partially implemented, the system MUST return a clear message that explains the limitation and gives the user a concrete next step.

#### Scenario: Unavailable command path
- **WHEN** a user invokes a command path that is intentionally not yet available
- **THEN** the output MUST explain that it is unavailable and MUST include at least one concrete alternative, workaround, or follow-up command

#### Scenario: Missing recovery command is not suggested
- **WHEN** the system reports a failure that recommends remediation
- **THEN** the remediation guidance MUST only mention commands or actions that actually exist in the current CLI surface

### Requirement: Empty and failure states SHALL be task-oriented
Each empty state and failure state MUST tell the user what condition was detected and what to do next in the current repository.

#### Scenario: Missing initialization state
- **WHEN** a user runs a command that depends on `.reins/constraints.yaml` or `.reins/hooks/` before initialization
- **THEN** the output MUST identify the missing prerequisite and direct the user to the correct next command

#### Scenario: Invalid rollback target
- **WHEN** a user requests a rollback target that does not exist
- **THEN** the output MUST explain the error and provide enough information to choose a valid snapshot

### Requirement: High-risk operations SHALL provide preflight clarity
Commands that mutate or restore saved state MUST summarize the pending action before execution and MUST provide a post-action summary of what changed.

#### Scenario: Interactive rollback
- **WHEN** a user initiates rollback without specifying `--to`
- **THEN** the interface MUST show available snapshots, clarify the selected target, and request confirmation before restoring state

#### Scenario: Direct rollback by id
- **WHEN** a user runs `reins rollback --to <snapshot>` with a valid snapshot id
- **THEN** the command MUST print a clear preflight summary and a completion summary of restored paths

### Requirement: Operational suggestions SHALL reflect evidence strength
The CLI MUST avoid presenting low-confidence heuristics as strong recommendations. Suggestions and follow-up advice SHALL be grounded in observable evidence and phrased according to certainty.

#### Scenario: Low-signal status observation
- **WHEN** status data is insufficient to support a meaningful recommendation
- **THEN** the interface MUST omit the recommendation or present it as a low-confidence observation rather than a prescriptive suggestion

#### Scenario: Supported output format
- **WHEN** a command advertises an output format in help text
- **THEN** the command MUST produce that format instead of silently falling back to a different format
