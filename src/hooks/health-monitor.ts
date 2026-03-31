import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookHealth {
  hookId: string;
  consecutiveErrors: number;
  lastError: string | null;
  lastSuccess: string | null;
  disabled: boolean;
  disabledReason: string | null;
}

interface HookHealthFile {
  version: number;
  hooks: HookHealth[];
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function healthFilePath(projectRoot: string): string {
  return join(projectRoot, '.reins', 'logs', 'hook-health.yaml');
}

export function loadHookHealth(projectRoot: string): Record<string, HookHealth> {
  const filePath = healthFilePath(projectRoot);
  if (!existsSync(filePath)) return {};

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as HookHealthFile | null;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.hooks)) {
      return {};
    }
    const result: Record<string, HookHealth> = {};
    for (const h of parsed.hooks) {
      if (h && typeof h.hookId === 'string') {
        result[h.hookId] = h;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveHookHealth(projectRoot: string, health: Record<string, HookHealth>): void {
  const logsDir = join(projectRoot, '.reins', 'logs');
  mkdirSync(logsDir, { recursive: true });

  const file: HookHealthFile = {
    version: 1,
    hooks: Object.values(health),
  };
  writeFileSync(healthFilePath(projectRoot), yaml.dump(file), 'utf-8');
}

function defaultHealth(hookId: string): HookHealth {
  return {
    hookId,
    consecutiveErrors: 0,
    lastError: null,
    lastSuccess: null,
    disabled: false,
    disabledReason: null,
  };
}

// ---------------------------------------------------------------------------
// disableHookInSettings
// ---------------------------------------------------------------------------

function disableHookInSettings(projectRoot: string, hookId: string): void {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;

  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command: string }> }>>;
    };

    if (!settings.hooks) return;

    let changed = false;
    for (const eventType of Object.keys(settings.hooks)) {
      const entries = settings.hooks[eventType];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!Array.isArray(entry.hooks)) continue;
        const before = entry.hooks.length;
        entry.hooks = entry.hooks.filter(
          (h: { command: string }) => !h.command.includes(hookId),
        );
        if (entry.hooks.length !== before) changed = true;
      }
    }

    if (changed) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    }
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// recordHookResult
// ---------------------------------------------------------------------------

export function recordHookResult(
  projectRoot: string,
  hookId: string,
  result: 'success' | 'error',
  error?: string,
): void {
  const health = loadHookHealth(projectRoot);
  const entry: HookHealth = health[hookId] ?? defaultHealth(hookId);

  const threshold = 5; // default; could be read from config

  if (result === 'success') {
    entry.consecutiveErrors = 0;
    entry.lastSuccess = new Date().toISOString();
  } else {
    entry.consecutiveErrors += 1;
    entry.lastError = error ?? 'unknown';

    if (entry.consecutiveErrors >= threshold && !entry.disabled) {
      entry.disabled = true;
      entry.disabledReason = `Consecutive errors: ${entry.consecutiveErrors}. Last: ${entry.lastError}`;
      disableHookInSettings(projectRoot, hookId);
    }
  }

  health[hookId] = entry;
  saveHookHealth(projectRoot, health);
}

// ---------------------------------------------------------------------------
// isHookDisabled / getAllHookHealth
// ---------------------------------------------------------------------------

export function isHookDisabled(projectRoot: string, hookId: string): boolean {
  const health = loadHookHealth(projectRoot);
  return health[hookId]?.disabled ?? false;
}

export function getAllHookHealth(projectRoot: string): HookHealth[] {
  const health = loadHookHealth(projectRoot);
  return Object.values(health);
}
