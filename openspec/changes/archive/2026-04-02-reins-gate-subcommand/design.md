## Context

This change replaces the current shell-grep-based hook scripts with a unified `reins gate` CLI subcommand. Each Claude Code hook event (UserPromptSubmit, PreToolUse, PostToolUse, Stop) calls `reins gate <event>`, which runs the full Reins Node.js runtime — constraint checking, knowledge retrieval, skill matching, and evaluation.

Relevant existing structures:

- `Constraint` and `ConstraintsConfig` in `src/constraints/schema.ts` define constraint types and enforcement config.
- `HookConfig` and `HookType` in `src/hooks/types.ts` define hook metadata.
- `generateHooks()` in `src/hooks/generator.ts` generates per-constraint shell scripts (to be replaced).
- `generateSettingsJson()` in `src/hooks/settings-writer.ts` registers hooks in `.claude/settings.json`.
- `retrieveKnowledge()` in `src/knowledge/retriever.ts` scores and returns relevant knowledge entries.
- `formatInjection()` in `src/knowledge/injector.ts` formats knowledge for prompt injection.
- `matchSkills()` in `src/pipeline/skill-matcher.ts` matches skills to tasks.
- `runL0Static()` in `src/evaluation/evaluator.ts` runs lint/typecheck/test.
- `runL1Coverage()` in `src/evaluation/evaluator.ts` checks test coverage rules.

## Goals / Non-Goals

**Goals:**
- Create `reins gate` CLI command with 5 subcommands: `context`, `pre-edit`, `post-edit`, `pre-bash`, `stop`.
- Each gate reads `CLAUDE_TOOL_INPUT` from environment and loads constraints from `.reins/constraints.yaml`.
- `gate context` dynamically injects constraints + knowledge + skills based on the user's prompt.
- `gate pre-edit` and `gate post-edit` check file edits against constraints using pattern matching (regex now, AST later).
- `gate pre-bash` guards dangerous commands and surfaces relevant knowledge.
- `gate stop` runs L0 evaluation and auto-captures knowledge from git diff.
- Replace N per-constraint hook scripts with 5 unified scripts (one per event type).
- All gate operations complete within 2 seconds (except `stop` which may run tests).

**Non-Goals:**
- AST-based code analysis (separate OpenSpec: `2026-04-02-ast-analysis-engine`).
- LLM-based constraint checking (gate must be deterministic, no API calls).
- Replacing Claude Code's own reasoning — gate influences via context injection and blocking, not by taking over execution.
- Supporting non-Claude-Code agents in this iteration (Cursor/Copilot hooks have different APIs).

## Decisions

### 1. Input handling: CLAUDE_TOOL_INPUT environment variable

Claude Code passes hook input as JSON in `CLAUDE_TOOL_INPUT`. Each gate command parses this:

```ts
interface GateInput {
  // Common
  tool_name?: string;

  // For Edit/Write (PreToolUse, PostToolUse)
  file_path?: string;
  path?: string;         // alias used by some tool calls
  old_string?: string;
  new_string?: string;

  // For Bash (PreToolUse)
  command?: string;

  // For UserPromptSubmit
  prompt?: string;

  // For Stop
  result?: string;
}

function parseGateInput(): GateInput {
  const raw = process.env.CLAUDE_TOOL_INPUT;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
```

Alternatives considered:
- Read from stdin: rejected because Claude Code uses environment variables for hook input.
- Accept as CLI arguments: rejected because JSON may contain special characters that break shell escaping.

### 2. Gate output protocol

Gate commands communicate with Claude Code via exit codes and stdout/stderr:

```
exit 0 → allow (any stdout text is shown to Claude as context)
exit 2 → block (stderr text is shown as the block reason)
```

Stdout is used for context injection (gate context, gate pre-edit warnings). Stderr is used for block messages. This matches Claude Code's existing hook protocol.

```ts
interface GateResult {
  action: 'allow' | 'warn' | 'block';
  messages: string[];      // stdout lines
  blockReason?: string;    // stderr, only when action === 'block'
}

function outputResult(result: GateResult): never {
  if (result.messages.length > 0) {
    console.log(result.messages.join('\n'));
  }
  if (result.action === 'block' && result.blockReason) {
    console.error(result.blockReason);
  }
  process.exit(result.action === 'block' ? 2 : 0);
}
```

### 3. Constraint loading and caching

Every gate invocation needs to load `constraints.yaml`. Since each invocation is a separate process, we cannot cache in memory across calls. But we can keep loading fast:

```ts
function loadConstraints(projectRoot: string): Constraint[] {
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(constraintsPath)) return [];
  const raw = readFileSync(constraintsPath, 'utf-8');
  const config = yaml.load(raw) as ConstraintsConfig;
  return config.constraints ?? [];
}
```

YAML parsing of a typical constraints file (< 5KB) takes < 10ms. No optimization needed.

Alternatives considered:
- Pre-compile constraints to JSON on init: rejected because it adds a cache invalidation problem.
- Daemon mode (keep Reins running): rejected as over-engineering for now. Node startup + YAML parse is fast enough.

### 4. Gate context: dynamic injection pipeline

```ts
async function gateContext(projectRoot: string, input: GateInput): Promise<GateResult> {
  const prompt = input.prompt ?? '';
  if (!prompt) return { action: 'allow', messages: [] };

  const constraints = loadConstraints(projectRoot);
  const messages: string[] = [];

  // 1. Constraint summary (critical + important)
  const relevant = constraints.filter(c =>
    c.severity === 'critical' || c.severity === 'important'
  );
  if (relevant.length > 0) {
    messages.push('[Reins Constraints]');
    for (const c of relevant) {
      messages.push(`  - [${c.severity}] ${c.rule}`);
    }
  }

  // 2. Knowledge retrieval
  const knowledge = retrieveKnowledge(projectRoot, {
    taskDescription: prompt,
    maxResults: 5,
  });
  if (knowledge.length > 0) {
    const injectionText = formatInjection(knowledge, { maxTokens: 1000 });
    messages.push('');
    messages.push(injectionText);
  }

  // 3. Skill matching (if index exists)
  const skillIndex = loadSkillIndex(projectRoot);
  if (skillIndex && skillIndex.skills.length > 0) {
    const config = loadConfig(projectRoot);
    const context = await loadCachedContext(projectRoot);
    const matched = matchSkillsFromIndex(prompt, skillIndex, config);
    if (matched.length > 0) {
      messages.push('');
      messages.push('[Reins Matched Skills]');
      for (const s of matched) {
        messages.push(`  - ${s.entry.title} (${s.entry.sourcePath})`);
      }
    }
  }

  return { action: 'allow', messages };
}
```

### 5. Gate pre-edit and post-edit: constraint matching

```ts
async function gatePreEdit(projectRoot: string, input: GateInput): Promise<GateResult> {
  const filePath = input.file_path ?? input.path ?? '';
  if (!filePath) return { action: 'allow', messages: [] };

  // Protection check
  if (isProtectedPath(filePath)) {
    return {
      action: 'block',
      messages: [],
      blockReason: `reins [block]: ${filePath} is protected by Reins. Do not modify constraint or hook files.`,
    };
  }

  const constraints = loadConstraints(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };

  // Check each enforceable constraint against the file content
  for (const c of constraints) {
    if (!c.enforcement.hook || c.enforcement.hook_type !== 'post_edit') continue;
    if (!c.enforcement.hook_check) continue;

    // For pre-edit, check new_string if available
    const content = input.new_string ?? '';
    if (!content) continue;

    const pattern = new RegExp(c.enforcement.hook_check);
    if (pattern.test(content)) {
      const mode = c.enforcement.hook_mode ?? 'block';
      if (mode === 'block') {
        return {
          action: 'block',
          messages: [],
          blockReason: `reins [block] ${c.id}: ${c.rule}`,
        };
      } else if (mode === 'warn') {
        result.messages.push(`reins [warn] ${c.id}: ${c.rule}`);
      }
    }
  }

  return result;
}

async function gatePostEdit(projectRoot: string, input: GateInput): Promise<GateResult> {
  const filePath = input.file_path ?? input.path ?? '';
  if (!filePath) return { action: 'allow', messages: [] };

  const constraints = loadConstraints(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };
  const absPath = resolve(projectRoot, filePath);

  if (!existsSync(absPath)) return result;
  const content = readFileSync(absPath, 'utf-8');

  for (const c of constraints) {
    if (!c.enforcement.hook || c.enforcement.hook_type !== 'post_edit') continue;
    if (!c.enforcement.hook_check) continue;

    // Scope check: skip constraints not relevant to this file's directory
    if (c.scope.startsWith('directory:')) {
      const dir = c.scope.replace('directory:', '');
      if (!filePath.startsWith(dir)) continue;
    }

    const pattern = new RegExp(c.enforcement.hook_check);
    if (pattern.test(content)) {
      const mode = c.enforcement.hook_mode ?? 'block';
      if (mode === 'block') {
        return {
          action: 'block',
          messages: [],
          blockReason: `reins [block] ${c.id}: ${c.rule} in ${filePath}`,
        };
      } else if (mode === 'warn') {
        result.messages.push(`reins [warn] ${c.id}: ${c.rule} in ${filePath}`);
      }
    }
  }

  return result;
}
```

### 6. Gate pre-bash: command guard with knowledge

```ts
async function gatePreBash(projectRoot: string, input: GateInput): Promise<GateResult> {
  const command = input.command ?? '';
  if (!command) return { action: 'allow', messages: [] };

  const constraints = loadConstraints(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };

  // Check bash guard constraints
  for (const c of constraints) {
    if (!c.enforcement.hook || c.enforcement.hook_type !== 'pre_bash') continue;
    if (!c.enforcement.hook_check) continue;

    const pattern = new RegExp(c.enforcement.hook_check);
    if (pattern.test(command)) {
      const mode = c.enforcement.hook_mode ?? 'block';
      if (mode === 'block') {
        return {
          action: 'block',
          messages: [],
          blockReason: `reins [block] ${c.id}: ${c.rule}`,
        };
      } else if (mode === 'warn') {
        result.messages.push(`reins [warn] ${c.id}: ${c.rule}`);
      }
    }
  }

  // Knowledge check: surface gotchas related to the command
  const knowledge = retrieveKnowledge(projectRoot, {
    taskDescription: command,
    maxResults: 3,
  });
  const gotchas = knowledge.filter(k => k.entry.type === 'gotcha');
  for (const g of gotchas) {
    result.messages.push(`reins [knowledge] ${g.entry.summary}`);
  }

  return result;
}
```

### 7. Gate stop: evaluation gate + knowledge capture

```ts
async function gateStop(projectRoot: string, input: GateInput): Promise<GateResult> {
  const config = loadConfig(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };

  // 1. L0 Static checks (lint + typecheck)
  //    Skip test by default in stop gate (too slow), configurable
  const gateConfig = config.gate ?? {};
  const skipTest = gateConfig.stop_skip_test ?? true;
  const l0 = await runL0Static(projectRoot, { skipTest });

  if (!l0.passed) {
    return {
      action: 'block',
      messages: [],
      blockReason: `reins [block] L0 verification failed:\n${l0.results.filter(r => !r.passed).map(r => `  - ${r.name}: ${r.error}`).join('\n')}`,
    };
  }

  // 2. L1 Coverage check: new files must have tests
  const l1 = await runL1Coverage(projectRoot);
  const failures = l1.results.filter(r => !r.passed);
  if (failures.length > 0) {
    for (const f of failures) {
      result.messages.push(`reins [warn] ${f.name}: ${f.message}`);
    }
  }

  // 3. Auto-capture knowledge from git diff
  const captured = await captureKnowledgeFromDiff(projectRoot);
  if (captured.length > 0) {
    result.messages.push('');
    result.messages.push(`[Reins] Captured ${captured.length} knowledge entries:`);
    for (const entry of captured) {
      result.messages.push(`  - [${entry.type}] ${entry.summary}`);
    }
  }

  return result;
}
```

### 8. Knowledge auto-capture from git diff

```ts
interface CapturedKnowledge {
  type: KnowledgeType;
  summary: string;
  files: string[];
  confidence: number;
}

async function captureKnowledgeFromDiff(projectRoot: string): Promise<CapturedKnowledge[]> {
  const captured: CapturedKnowledge[] = [];

  // Get changed files from git
  const diff = execSync('git diff --cached --name-only 2>/dev/null || git diff --name-only', {
    cwd: projectRoot, encoding: 'utf-8',
  }).trim();
  if (!diff) return captured;

  const changedFiles = diff.split('\n').filter(Boolean);

  // Detect coupling: files from different modules changed together
  const modules = new Map<string, string[]>();
  for (const file of changedFiles) {
    const module = file.split('/').slice(0, 2).join('/');
    if (!modules.has(module)) modules.set(module, []);
    modules.get(module)!.push(file);
  }
  if (modules.size >= 2) {
    const moduleNames = [...modules.keys()];
    captured.push({
      type: 'coupling',
      summary: `${moduleNames.join(' and ')} were modified together`,
      files: changedFiles,
      confidence: 50,
    });
  }

  // Detect decisions: new config files or dependency changes
  for (const file of changedFiles) {
    if (file === 'package.json' || file === 'go.mod' || file === 'Cargo.toml') {
      captured.push({
        type: 'decision',
        summary: `Dependencies changed in ${file}`,
        files: [file],
        confidence: 40,
      });
    }
  }

  // Save captured entries to knowledge store
  for (const entry of captured) {
    saveEntry(projectRoot, {
      id: generateId(projectRoot),
      type: entry.type,
      summary: entry.summary,
      detail: '',
      source: 'reflection',
      confidence: entry.confidence,
      triggers: { keywords: [], files: entry.files, commands: [] },
      createdAt: new Date().toISOString(),
      lastValidated: null,
      lastInjected: null,
      injectionOutcomes: { success: 0, failure: 0, neutral: 0 },
    });
  }

  return captured;
}
```

### 9. Hook generator rewrite

Replace per-constraint scripts with 5 unified scripts:

```ts
const GATE_SCRIPT_TMPL = `#!/bin/bash
# reins gate: {{EVENT}} hook
# Calls Reins Node.js runtime for full constraint checking
exec reins gate {{EVENT}}
`;

export function generateGateHooks(projectRoot: string): HookConfig[] {
  const outputDir = join(projectRoot, '.reins', 'hooks');
  mkdirSync(outputDir, { recursive: true });

  // Always generate protection hook (unchanged)
  generateProtectionHook(outputDir);

  const events: { event: string; hookType: HookType; filename: string }[] = [
    { event: 'context', hookType: 'context_inject', filename: 'gate-context.sh' },
    { event: 'pre-edit', hookType: 'post_edit', filename: 'gate-pre-edit.sh' },
    { event: 'post-edit', hookType: 'post_edit', filename: 'gate-post-edit.sh' },
    { event: 'pre-bash', hookType: 'pre_bash', filename: 'gate-pre-bash.sh' },
    { event: 'stop', hookType: 'pre_complete', filename: 'gate-stop.sh' },
  ];

  const configs: HookConfig[] = [];
  for (const { event, hookType, filename } of events) {
    const script = GATE_SCRIPT_TMPL.replace(/\{\{EVENT\}\}/g, event);
    const scriptPath = join(outputDir, filename);
    writeFileSync(scriptPath, script, { encoding: 'utf-8', mode: 0o755 });
    configs.push({
      constraintId: `gate-${event}`,
      hookType,
      scriptPath,
      mode: 'block',
      description: `Reins gate: ${event}`,
    });
  }

  return configs;
}
```

### 10. Settings writer simplification

Instead of registering per-constraint hooks, register per-event hooks:

```ts
// Before (N entries per event):
{
  "PreToolUse": [
    { "matcher": "Edit|Write", "hooks": [
      { "type": "command", "command": ".reins/hooks/constraint-1.sh" },
      { "type": "command", "command": ".reins/hooks/constraint-2.sh" }
    ]},
    { "matcher": "Bash", "hooks": [
      { "type": "command", "command": ".reins/hooks/constraint-3.sh" }
    ]}
  ]
}

// After (1 entry per event):
{
  "PreToolUse": [
    { "matcher": "Edit|Write", "hooks": [
      { "type": "command", "command": ".reins/hooks/protect-constraints.sh" },
      { "type": "command", "command": ".reins/hooks/gate-pre-edit.sh" }
    ]},
    { "matcher": "Bash", "hooks": [
      { "type": "command", "command": ".reins/hooks/gate-pre-bash.sh" }
    ]}
  ],
  "PostToolUse": [
    { "matcher": "Edit|Write", "hooks": [
      { "type": "command", "command": ".reins/hooks/gate-post-edit.sh" }
    ]}
  ],
  "UserPromptSubmit": [
    { "hooks": [
      { "type": "command", "command": ".reins/hooks/gate-context.sh" }
    ]}
  ],
  "Stop": [
    { "hooks": [
      { "type": "command", "command": ".reins/hooks/gate-stop.sh" }
    ]}
  ]
}
```

## File Structure

```
src/
├── gate/
│   ├── index.ts              # Entry point: parseInput + route to handler
│   ├── context.ts            # UserPromptSubmit: constraint + knowledge + skill injection
│   ├── pre-edit.ts           # PreToolUse (Edit/Write): constraint check before edit
│   ├── post-edit.ts          # PostToolUse (Edit/Write): constraint check after edit
│   ├── pre-bash.ts           # PreToolUse (Bash): command guard + knowledge
│   ├── stop.ts               # Stop: L0 evaluation + knowledge capture
│   ├── shared.ts             # Shared utilities: loadConstraints, parseInput, outputResult, isProtectedPath
│   └── gate.test.ts          # Tests for all gate handlers
├── commands/
│   └── gate.ts               # CLI command registration (reins gate <event>)
├── hooks/
│   ├── generator.ts          # Rewritten: generate 5 unified gate scripts
│   └── settings-writer.ts    # Simplified: register per-event hooks
└── cli.ts                    # Add gate command
```

## Risks / Trade-offs

- [Node.js startup per hook invocation] → Measured at ~150ms for compiled JS. Claude Code hook timeout is 30s+. Acceptable.
- [Gate stop running lint/typecheck may block for 10s+] → Mitigate with `gate.stop_skip_test: true` default. Only lint + typecheck by default.
- [Breaking change for existing hook scripts] → Mitigate: `reins init` regenerates hooks. Old scripts in `.reins/hooks/` are overwritten. Document in changelog.
- [Knowledge capture from git diff is heuristic-based] → Captured entries start at confidence 50 (draft). They must be validated through the existing graduation pipeline before becoming constraints.
