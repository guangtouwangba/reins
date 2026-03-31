import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Action } from './analyzer.js';
import { applyAction } from './constraint-updater.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearnerConfig {
  autoThreshold?: number;   // default 85
  suggestThreshold?: number; // default 60
}

export interface ExecutedAction {
  action: Action;
  disposition: 'auto_applied' | 'suggested' | 'logged';
}

// ---------------------------------------------------------------------------
// executeActions
// ---------------------------------------------------------------------------

export async function executeActions(
  projectRoot: string,
  actions: Action[],
  config: LearnerConfig = {},
): Promise<ExecutedAction[]> {
  const autoThreshold = config.autoThreshold ?? 85;
  const suggestThreshold = config.suggestThreshold ?? 60;

  const results: ExecutedAction[] = [];

  for (const action of actions) {
    if (action.confidence > autoThreshold) {
      // Auto-apply
      try {
        applyAction(projectRoot, action);
        results.push({ action, disposition: 'auto_applied' });
      } catch {
        // If auto-apply fails, fall back to suggestion
        results.push({ action, disposition: 'suggested' });
        writePendingAction(projectRoot, action);
      }
    } else if (action.confidence >= suggestThreshold) {
      // Suggest to user
      results.push({ action, disposition: 'suggested' });
      writePendingAction(projectRoot, action);
    } else {
      // Low confidence — log only
      results.push({ action, disposition: 'logged' });
      writeLowConfidenceAction(projectRoot, action);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Pending actions (medium confidence)
// ---------------------------------------------------------------------------

function writePendingAction(projectRoot: string, action: Action): void {
  const logsDir = join(projectRoot, '.reins', 'logs');
  mkdirSync(logsDir, { recursive: true });
  const filePath = join(logsDir, 'pending-actions.yaml');

  const entry = {
    timestamp: new Date().toISOString(),
    action,
  };

  const line = yaml.dump([entry], { lineWidth: 120 }).trimEnd();

  if (existsSync(filePath)) {
    appendFileSync(filePath, '\n' + line.replace(/^- /, '- '), 'utf-8');
  } else {
    writeFileSync(filePath, line + '\n', 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Low-confidence log
// ---------------------------------------------------------------------------

function writeLowConfidenceAction(projectRoot: string, action: Action): void {
  const logsDir = join(projectRoot, '.reins', 'logs');
  mkdirSync(logsDir, { recursive: true });
  const filePath = join(logsDir, 'low-confidence.yaml');

  const entry = {
    timestamp: new Date().toISOString(),
    action,
  };

  const line = yaml.dump([entry], { lineWidth: 120 }).trimEnd();

  if (existsSync(filePath)) {
    appendFileSync(filePath, '\n' + line.replace(/^- /, '- '), 'utf-8');
  } else {
    writeFileSync(filePath, line + '\n', 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Load pending actions (for CLI display)
// ---------------------------------------------------------------------------

export function loadPendingActions(projectRoot: string): Action[] {
  const filePath = join(projectRoot, '.reins', 'logs', 'pending-actions.yaml');
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Array<{ action: Action }> | null;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(p => p.action).filter(Boolean);
  } catch {
    return [];
  }
}
