import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSettingsJson } from './settings-writer.js';
import type { HookConfig } from './types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHookConfig(overrides?: Partial<HookConfig>): HookConfig {
  return {
    constraintId: 'gate-context',
    hookType: 'context_inject',
    scriptPath: '.reins/hooks/gate-context.sh',
    mode: 'block',
    description: 'Reins gate: context',
    ...overrides,
  };
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('generateSettingsJson', () => {
  it('creates .claude directory', () => {
    generateSettingsJson(tmpDir, []);
    expect(existsSync(join(tmpDir, '.claude'))).toBe(true);
  });

  it('creates settings.json file', () => {
    generateSettingsJson(tmpDir, [makeHookConfig()]);
    const path = join(tmpDir, '.claude', 'settings.json');
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content.hooks).toBeDefined();
  });

  it('maps context_inject to UserPromptSubmit', () => {
    generateSettingsJson(tmpDir, [makeHookConfig({ hookType: 'context_inject' })]);
    const content = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    expect(content.hooks.UserPromptSubmit).toBeDefined();
    expect(content.hooks.UserPromptSubmit.length).toBeGreaterThan(0);
  });

  it('maps pre_bash to PreToolUse with Bash matcher', () => {
    generateSettingsJson(tmpDir, [
      makeHookConfig({ constraintId: 'gate-pre-bash', hookType: 'pre_bash', scriptPath: '.reins/hooks/gate-pre-bash.sh' }),
    ]);
    const content = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    const preToolUse = content.hooks.PreToolUse as Array<{ matcher?: string }>;
    const bashEntry = preToolUse.find(e => e.matcher === 'Bash');
    expect(bashEntry).toBeDefined();
  });

  it('maps post_edit to PostToolUse with Edit|Write matcher', () => {
    generateSettingsJson(tmpDir, [
      makeHookConfig({ constraintId: 'gate-post-edit', hookType: 'post_edit', scriptPath: '.reins/hooks/gate-post-edit.sh' }),
    ]);
    const content = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    expect(content.hooks.PostToolUse).toBeDefined();
    const editEntry = content.hooks.PostToolUse.find((e: { matcher?: string }) => e.matcher === 'Edit|Write');
    expect(editEntry).toBeDefined();
  });

  it('preserves existing non-reins hooks', () => {
    const claudeDir = join(tmpDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-custom-hook.sh' }] }],
      },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existing), 'utf-8');

    generateSettingsJson(tmpDir, [makeHookConfig()]);
    const content = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'));
    const preToolUse = content.hooks.PreToolUse as Array<{ hooks: Array<{ command: string }> }>;
    const customHook = preToolUse.find(e => e.hooks.some(h => h.command === 'my-custom-hook.sh'));
    expect(customHook).toBeDefined();
  });

  it('replaces old reins hooks on re-run', () => {
    generateSettingsJson(tmpDir, [makeHookConfig()]);
    generateSettingsJson(tmpDir, [makeHookConfig()]);
    const content = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    // Should not have duplicated reins entries
    const userPrompt = content.hooks.UserPromptSubmit as Array<{ _reins?: boolean }>;
    const reinsEntries = userPrompt.filter(e => e._reins);
    expect(reinsEntries.length).toBe(1);
  });

  it('always includes protection hook in PreToolUse', () => {
    generateSettingsJson(tmpDir, []);
    const content = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    const preToolUse = content.hooks.PreToolUse as Array<{ hooks: Array<{ command: string }> }>;
    const protectEntry = preToolUse?.find(e =>
      e.hooks.some(h => h.command.includes('protect-constraints')),
    );
    expect(protectEntry).toBeDefined();
  });

  it('throws on malformed existing settings.json', () => {
    const claudeDir = join(tmpDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), 'not json!!!', 'utf-8');
    expect(() => generateSettingsJson(tmpDir, [])).toThrow('Cannot parse');
  });
});
