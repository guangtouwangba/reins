import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Action } from './analyzer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConstraintRule {
  id?: string;
  rule?: string;
  severity?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}

interface ConstraintsFile {
  version?: number;
  rules?: ConstraintRule[];
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

export function applyAction(projectRoot: string, action: Action): void {
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');

  let constraints: ConstraintsFile = { version: 1, rules: [] };
  if (existsSync(constraintsPath)) {
    try {
      const raw = readFileSync(constraintsPath, 'utf-8');
      const parsed = yaml.load(raw) as ConstraintsFile | null;
      if (parsed && typeof parsed === 'object') {
        constraints = parsed;
        if (!Array.isArray(constraints.rules)) {
          constraints.rules = [];
        }
      }
    } catch {
      // use defaults
    }
  }

  const before = yaml.dump(constraints, { lineWidth: 120 });

  switch (action.type) {
    case 'add_constraint': {
      const newRule: ConstraintRule = {
        id: `auto-${Date.now()}`,
        rule: action.rule,
        severity: action.severity,
      };
      constraints.rules!.push(newRule);
      break;
    }

    case 'remove_constraint': {
      const target = constraints.rules!.find(r => r.rule === action.rule || r.id === action.rule);
      if (target) {
        target.deprecated = true;
        target.deprecationReason = action.reason;
      }
      break;
    }

    case 'create_skill': {
      writeSkillFile(projectRoot, action.content);
      appendChangelog(projectRoot, action, '', action.content);
      return;
    }

    case 'add_hook': {
      // Hook addition is best-effort — write a note to pending
      appendChangelog(projectRoot, action, '', `add hook for constraint ${action.constraintId}`);
      return;
    }
  }

  const after = yaml.dump(constraints, { lineWidth: 120 });

  // Ensure directory exists
  mkdirSync(join(projectRoot, '.reins'), { recursive: true });
  writeFileSync(constraintsPath, after, 'utf-8');

  appendChangelog(projectRoot, action, before, after);
}

// ---------------------------------------------------------------------------
// appendChangelog
// ---------------------------------------------------------------------------

export function appendChangelog(
  projectRoot: string,
  action: Action,
  before: string,
  after: string,
): void {
  const logsDir = join(projectRoot, '.reins', 'logs');
  mkdirSync(logsDir, { recursive: true });
  const changelogPath = join(logsDir, 'constraint-changelog.yaml');

  const entry = {
    timestamp: new Date().toISOString(),
    actionType: action.type,
    confidence: action.confidence,
    before: before.slice(0, 500),
    after: after.slice(0, 500),
  };

  const line = yaml.dump([entry], { lineWidth: 120 });

  if (existsSync(changelogPath)) {
    appendFileSync(changelogPath, line, 'utf-8');
  } else {
    writeFileSync(changelogPath, line, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// writeSkillFile (for create_skill actions)
// ---------------------------------------------------------------------------

function writeSkillFile(projectRoot: string, content: string): void {
  const autoDir = join(projectRoot, '.reins', 'skills', 'auto');
  mkdirSync(autoDir, { recursive: true });

  const timestamp = Date.now();
  const filePath = join(autoDir, `skill-${timestamp}.yaml`);
  writeFileSync(filePath, content, 'utf-8');
}
