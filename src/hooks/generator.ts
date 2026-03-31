import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Constraint, ConstraintsConfig, HookType } from '../constraints/schema.js';
import type { HookConfig } from './types.js';
import { generateProtectionHook } from './protection.js';

// ---------------------------------------------------------------------------
// Shell script templates as TypeScript string constants
// ---------------------------------------------------------------------------

const POST_EDIT_CHECK_TMPL = `#!/bin/bash
# reins: {{CONSTRAINT_ID}} — post-edit check
# {{ERROR_MESSAGE}}
command -v jq >/dev/null || { echo "reins hooks require jq" >&2; exit 0; }

MODE="{{MODE}}"
[ "$MODE" = "off" ] && exit 0

FILE=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.path // .file_path // ""' 2>/dev/null)
[ -z "$FILE" ] && exit 0

if grep -qE '{{CHECK_PATTERN}}' "$FILE" 2>/dev/null; then
  if [ "$MODE" = "warn" ]; then
    echo "reins [warn] {{CONSTRAINT_ID}}: {{ERROR_MESSAGE}} in $FILE"
    exit 0
  fi
  echo "reins [block] {{CONSTRAINT_ID}}: {{ERROR_MESSAGE}} in $FILE" >&2
  exit 2
fi

exit 0
`;

const BASH_GUARD_TMPL = `#!/bin/bash
# reins: {{CONSTRAINT_ID}} — bash guard
# {{ERROR_MESSAGE}}
command -v jq >/dev/null || { echo "reins hooks require jq" >&2; exit 0; }

MODE="{{MODE}}"
[ "$MODE" = "off" ] && exit 0

CMD=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.command // ""' 2>/dev/null)
[ -z "$CMD" ] && exit 0

if echo "$CMD" | grep -qE '{{CHECK_PATTERN}}'; then
  if [ "$MODE" = "warn" ]; then
    echo "reins [warn] {{CONSTRAINT_ID}}: {{ERROR_MESSAGE}}"
    exit 0
  fi
  echo "reins [block] {{CONSTRAINT_ID}}: {{ERROR_MESSAGE}}" >&2
  exit 2
fi

exit 0
`;

const PRE_COMPLETE_TMPL = `#!/bin/bash
# reins: {{CONSTRAINT_ID}} — pre-complete check
# {{ERROR_MESSAGE}}
command -v jq >/dev/null || { echo "reins hooks require jq" >&2; exit 0; }

MODE="{{MODE}}"
[ "$MODE" = "off" ] && exit 0

if ! {{CHECK_COMMAND}} 2>/tmp/reins-check-err; then
  ERR=$(cat /tmp/reins-check-err)
  if [ "$MODE" = "warn" ]; then
    echo "reins [warn] {{CONSTRAINT_ID}}: {{ERROR_MESSAGE}} — $ERR"
    exit 0
  fi
  echo "reins [block] {{CONSTRAINT_ID}}: {{ERROR_MESSAGE}} — $ERR" >&2
  exit 2
fi

exit 0
`;

const CONTEXT_INJECT_TMPL = `#!/bin/bash
# reins: {{CONSTRAINT_ID}} — context inject
# {{ERROR_MESSAGE}}
command -v jq >/dev/null || { echo "reins hooks require jq" >&2; exit 0; }

MODE="{{MODE}}"
[ "$MODE" = "off" ] && exit 0

PROMPT=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.prompt // ""' 2>/dev/null)
[ -z "$PROMPT" ] && exit 0

if echo "$PROMPT" | grep -qiE '{{CHECK_PATTERN}}'; then
  echo "reins context [{{CONSTRAINT_ID}}]: {{ERROR_MESSAGE}}"
fi

exit 0
`;

const TEMPLATES: Record<HookType, string> = {
  post_edit: POST_EDIT_CHECK_TMPL,
  pre_bash: BASH_GUARD_TMPL,
  pre_complete: PRE_COMPLETE_TMPL,
  context_inject: CONTEXT_INJECT_TMPL,
};

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

function renderTemplate(template: string, constraint: Constraint): string {
  const e = constraint.enforcement;
  const checkPattern = e.hook_check ?? '';
  const mode = e.hook_mode ?? 'block';

  return template
    .replace(/\{\{CONSTRAINT_ID\}\}/g, constraint.id)
    .replace(/\{\{CHECK_PATTERN\}\}/g, checkPattern)
    .replace(/\{\{ERROR_MESSAGE\}\}/g, constraint.rule.replace(/'/g, "'\\''"))
    .replace(/\{\{MODE\}\}/g, mode)
    .replace(/\{\{CHECK_COMMAND\}\}/g, checkPattern || 'true');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateHooks(projectRoot: string, constraintsPath: string): HookConfig[] {
  const outputDir = join(projectRoot, '.reins', 'hooks');
  mkdirSync(outputDir, { recursive: true });

  // Always generate the protection hook
  generateProtectionHook(outputDir);

  if (!existsSync(constraintsPath)) {
    return [];
  }

  let config: ConstraintsConfig;
  try {
    const raw = readFileSync(constraintsPath, 'utf-8');
    config = yaml.load(raw) as ConstraintsConfig;
  } catch {
    return [];
  }

  const constraints = config.constraints ?? [];
  const enforceableConstraints = constraints.filter(
    c => c.enforcement?.hook === true && c.enforcement.hook_type,
  );

  const hookConfigs: HookConfig[] = [];

  for (const constraint of enforceableConstraints) {
    const hookType = constraint.enforcement.hook_type!;
    const template = TEMPLATES[hookType];
    if (!template) continue;

    const rendered = renderTemplate(template, constraint);
    const scriptPath = join(outputDir, `${constraint.id}.sh`);
    writeFileSync(scriptPath, rendered, { encoding: 'utf-8', mode: 0o755 });

    hookConfigs.push({
      constraintId: constraint.id,
      hookType,
      scriptPath,
      mode: constraint.enforcement.hook_mode ?? 'block',
      description: constraint.rule,
    });
  }

  return hookConfigs;
}
