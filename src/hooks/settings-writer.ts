import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { HookConfig } from './types.js';

// ---------------------------------------------------------------------------
// Types for Claude Code settings.json format
// ---------------------------------------------------------------------------

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
  _reins?: boolean;
}

interface HookCommand {
  type: 'command';
  command: string;
  _reins?: boolean;
}

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: HookEntry[];
    PreToolUse?: HookEntry[];
    Stop?: HookEntry[];
    UserPromptSubmit?: HookEntry[];
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Hook type → event mapping
// ---------------------------------------------------------------------------

function hookTypeToEvent(hookType: string): 'PostToolUse' | 'PreToolUse' | 'Stop' | 'UserPromptSubmit' {
  switch (hookType) {
    case 'post_edit':
      return 'PostToolUse';
    case 'pre_bash':
      return 'PreToolUse';
    case 'pre_complete':
      return 'Stop';
    case 'context_inject':
      return 'UserPromptSubmit';
    default:
      return 'PostToolUse';
  }
}

function hookTypeToMatcher(hookType: string): string {
  switch (hookType) {
    case 'post_edit':
      return 'Edit|Write';
    case 'pre_bash':
      return 'Bash';
    case 'pre_complete':
      return '';
    case 'context_inject':
      return '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Build reins-managed entries
// ---------------------------------------------------------------------------

function buildReinsEntries(hooks: HookConfig[]): Record<string, HookEntry[]> {
  const buckets: Record<string, Map<string, HookCommand[]>> = {
    PostToolUse: new Map(),
    PreToolUse: new Map(),
    Stop: new Map(),
    UserPromptSubmit: new Map(),
  };

  for (const hook of hooks) {
    const event = hookTypeToEvent(hook.hookType);
    const matcher = hookTypeToMatcher(hook.hookType);
    const bucket = buckets[event];
    if (!bucket) continue;

    if (!bucket.has(matcher)) {
      bucket.set(matcher, []);
    }
    bucket.get(matcher)!.push({
      type: 'command',
      command: hook.scriptPath,
      _reins: true,
    });
  }

  // Always add protection hook to PreToolUse with Edit|Write matcher
  const preToolUse = buckets['PreToolUse']!;
  if (!preToolUse.has('Edit|Write')) {
    preToolUse.set('Edit|Write', []);
  }
  // Prepend protection hook so it always runs first
  preToolUse.get('Edit|Write')!.unshift({
    type: 'command',
    command: '.reins/hooks/protect-constraints.sh',
    _reins: true,
  });

  const result: Record<string, HookEntry[]> = {};
  for (const [event, matcherMap] of Object.entries(buckets)) {
    const entries: HookEntry[] = [];
    for (const [matcher, commands] of matcherMap.entries()) {
      if (commands.length === 0) continue;
      const entry: HookEntry = { hooks: commands, _reins: true };
      if (matcher) entry.matcher = matcher;
      entries.push(entry);
    }
    if (entries.length > 0) {
      result[event] = entries;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Merge with existing settings
// ---------------------------------------------------------------------------

function mergeSettings(existing: ClaudeSettings, reinsEntries: Record<string, HookEntry[]>): ClaudeSettings {
  const merged: ClaudeSettings = { ...existing };
  merged.hooks = { ...(existing.hooks ?? {}) };

  const events = ['PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit'] as const;

  for (const event of events) {
    const existingEntries: HookEntry[] = (existing.hooks?.[event] as HookEntry[] | undefined) ?? [];
    const userEntries = existingEntries.filter(e => !e._reins);
    const newReinsEntries = reinsEntries[event] ?? [];
    merged.hooks[event] = [...userEntries, ...newReinsEntries];
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateSettingsJson(projectRoot: string, hooks: HookConfig[]): void {
  const claudeDir = join(projectRoot, '.claude');
  mkdirSync(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, 'settings.json');
  const tmpPath = join(claudeDir, 'settings.json.tmp');

  let existing: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      existing = JSON.parse(raw) as ClaudeSettings;
    } catch {
      existing = {};
    }
  }

  const reinsEntries = buildReinsEntries(hooks);
  const merged = mergeSettings(existing, reinsEntries);

  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
  renameSync(tmpPath, settingsPath);
}
