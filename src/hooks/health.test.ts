import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadHookHealth,
  saveHookHealth,
  recordHookResult,
  isHookDisabled,
  getAllHookHealth,
} from './health-monitor.js';
import type { HookHealth } from './health-monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `reins-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// loadHookHealth / saveHookHealth
// ---------------------------------------------------------------------------

describe('loadHookHealth', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty object when file does not exist', () => {
    const result = loadHookHealth(tmpDir);
    expect(result).toEqual({});
  });

  it('loads health entries from file', () => {
    const health: HookHealth = {
      hookId: 'test-hook',
      consecutiveErrors: 2,
      lastError: 'jq not found',
      lastSuccess: null,
      disabled: false,
      disabledReason: null,
    };
    saveHookHealth(tmpDir, { 'test-hook': health });

    const loaded = loadHookHealth(tmpDir);
    expect(loaded['test-hook']).toBeDefined();
    expect(loaded['test-hook']?.consecutiveErrors).toBe(2);
    expect(loaded['test-hook']?.lastError).toBe('jq not found');
  });
});

describe('saveHookHealth', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates .reins/logs directory if absent', () => {
    saveHookHealth(tmpDir, {});
    expect(existsSync(join(tmpDir, '.reins', 'logs', 'hook-health.yaml'))).toBe(true);
  });

  it('round-trips health data', () => {
    const health: HookHealth = {
      hookId: 'no-direct-sql',
      consecutiveErrors: 0,
      lastError: null,
      lastSuccess: '2026-03-31T10:00:00Z',
      disabled: false,
      disabledReason: null,
    };
    saveHookHealth(tmpDir, { 'no-direct-sql': health });
    const loaded = loadHookHealth(tmpDir);
    expect(loaded['no-direct-sql']?.lastSuccess).toBe('2026-03-31T10:00:00Z');
    expect(loaded['no-direct-sql']?.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordHookResult
// ---------------------------------------------------------------------------

describe('recordHookResult', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates health entry on first call', () => {
    recordHookResult(tmpDir, 'new-hook', 'success');
    const health = loadHookHealth(tmpDir);
    expect(health['new-hook']).toBeDefined();
  });

  it('sets lastSuccess on success result', () => {
    const before = Date.now();
    recordHookResult(tmpDir, 'hook-a', 'success');
    const health = loadHookHealth(tmpDir);
    const ts = health['hook-a']?.lastSuccess;
    expect(ts).not.toBeNull();
    expect(new Date(ts!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('resets consecutiveErrors to 0 on success', () => {
    // Prime with some errors
    saveHookHealth(tmpDir, {
      'hook-b': {
        hookId: 'hook-b',
        consecutiveErrors: 3,
        lastError: 'some error',
        lastSuccess: null,
        disabled: false,
        disabledReason: null,
      },
    });
    recordHookResult(tmpDir, 'hook-b', 'success');
    const health = loadHookHealth(tmpDir);
    expect(health['hook-b']?.consecutiveErrors).toBe(0);
  });

  it('increments consecutiveErrors on error', () => {
    recordHookResult(tmpDir, 'hook-c', 'error', 'script crashed');
    recordHookResult(tmpDir, 'hook-c', 'error', 'script crashed again');
    const health = loadHookHealth(tmpDir);
    expect(health['hook-c']?.consecutiveErrors).toBe(2);
    expect(health['hook-c']?.lastError).toBe('script crashed again');
  });

  it('sets lastError to "unknown" when no error message provided', () => {
    recordHookResult(tmpDir, 'hook-d', 'error');
    const health = loadHookHealth(tmpDir);
    expect(health['hook-d']?.lastError).toBe('unknown');
  });

  it('auto-disables hook at threshold (5 consecutive errors)', () => {
    for (let i = 0; i < 5; i++) {
      recordHookResult(tmpDir, 'hook-e', 'error', 'jq not found');
    }
    const health = loadHookHealth(tmpDir);
    expect(health['hook-e']?.disabled).toBe(true);
    expect(health['hook-e']?.disabledReason).toContain('Consecutive errors: 5');
    expect(health['hook-e']?.disabledReason).toContain('jq not found');
  });

  it('does not disable before threshold', () => {
    for (let i = 0; i < 4; i++) {
      recordHookResult(tmpDir, 'hook-f', 'error', 'error');
    }
    const health = loadHookHealth(tmpDir);
    expect(health['hook-f']?.disabled).toBe(false);
  });

  it('does not increment consecutiveErrors after already disabled', () => {
    for (let i = 0; i < 5; i++) {
      recordHookResult(tmpDir, 'hook-g', 'error', 'crash');
    }
    // one more error after disabled
    recordHookResult(tmpDir, 'hook-g', 'error', 'crash');
    const health = loadHookHealth(tmpDir);
    expect(health['hook-g']?.disabled).toBe(true);
    // consecutiveErrors continues incrementing but hook stays disabled
    expect(health['hook-g']?.consecutiveErrors).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// isHookDisabled
// ---------------------------------------------------------------------------

describe('isHookDisabled', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns false when hook has no health record', () => {
    expect(isHookDisabled(tmpDir, 'unknown-hook')).toBe(false);
  });

  it('returns false for enabled hook', () => {
    recordHookResult(tmpDir, 'good-hook', 'success');
    expect(isHookDisabled(tmpDir, 'good-hook')).toBe(false);
  });

  it('returns true for auto-disabled hook', () => {
    for (let i = 0; i < 5; i++) {
      recordHookResult(tmpDir, 'bad-hook', 'error', 'crash');
    }
    expect(isHookDisabled(tmpDir, 'bad-hook')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllHookHealth
// ---------------------------------------------------------------------------

describe('getAllHookHealth', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty array when no health file exists', () => {
    expect(getAllHookHealth(tmpDir)).toEqual([]);
  });

  it('returns all hook health entries', () => {
    recordHookResult(tmpDir, 'hook-1', 'success');
    recordHookResult(tmpDir, 'hook-2', 'error', 'crash');
    const all = getAllHookHealth(tmpDir);
    expect(all).toHaveLength(2);
    expect(all.map(h => h.hookId).sort()).toEqual(['hook-1', 'hook-2'].sort());
  });
});

// ---------------------------------------------------------------------------
// disableHookInSettings integration
// ---------------------------------------------------------------------------

describe('disableHookInSettings (via recordHookResult)', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removes hook command from settings.json when auto-disabled', () => {
    // Create a settings.json with the hook command
    const claudeDir = join(tmpDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit',
            hooks: [
              { type: 'command', command: '/path/to/crash-hook.sh' },
              { type: 'command', command: '/path/to/other-hook.sh' },
            ],
          },
        ],
      },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(settings), 'utf-8');

    // Trigger auto-disable
    for (let i = 0; i < 5; i++) {
      recordHookResult(tmpDir, 'crash-hook', 'error', 'crash');
    }

    const updated = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as typeof settings;
    const commands = updated.hooks.PostToolUse[0]?.hooks.map(h => h.command) ?? [];
    // crash-hook.sh should have been removed
    expect(commands.some(c => c.includes('crash-hook'))).toBe(false);
    // other-hook.sh should remain
    expect(commands).toContain('/path/to/other-hook.sh');
  });
});
