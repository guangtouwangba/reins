import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { generateHooks } from './generator.js';
import { generateProtectionHook } from './protection.js';
import { generateSettingsJson } from './settings-writer.js';
import type { HookConfig } from './types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConstraintsYaml(dir: string, constraints: unknown[]): string {
  const config = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'library' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints,
    pipeline: { planning: 'ultrathink', execution: 'default', verification: { engine: 'reins', max_iterations: 3 }, qa: true, pre_commit: [], post_develop: [] },
    profiles: {},
  };
  const reinsDir = join(dir, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  const path = join(reinsDir, 'constraints.yaml');
  writeFileSync(path, yaml.dump(config), 'utf-8');
  return path;
}

describe('generateProtectionHook', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes protect-constraints.sh to the output dir', () => {
    generateProtectionHook(tmpDir);
    const scriptPath = join(tmpDir, 'protect-constraints.sh');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('script contains the protected path patterns', () => {
    generateProtectionHook(tmpDir);
    const content = readFileSync(join(tmpDir, 'protect-constraints.sh'), 'utf-8');
    expect(content).toContain('.reins/constraints.yaml');
    expect(content).toContain('.reins/config.yaml');
    expect(content).toContain('.reins/hooks/');
  });

  it('script is executable (mode includes 0o755)', () => {
    generateProtectionHook(tmpDir);
    const stat = statSync(join(tmpDir, 'protect-constraints.sh'));
    // Check owner execute bit (0o100 = owner execute)
    expect(stat.mode & 0o100).toBe(0o100);
  });
});

describe('generateHooks', () => {
  let projectRoot: string;

  beforeEach(() => { projectRoot = makeTmpDir(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  it('always returns 5 gate hook configs', () => {
    const result = generateHooks(projectRoot);
    expect(result).toHaveLength(5);
    expect(result.map(h => h.constraintId).sort()).toEqual([
      'gate-context', 'gate-post-edit', 'gate-pre-bash', 'gate-pre-edit', 'gate-stop',
    ]);
  });

  it('always writes protect-constraints.sh', () => {
    generateHooks(projectRoot);
    expect(existsSync(join(projectRoot, '.reins', 'hooks', 'protect-constraints.sh'))).toBe(true);
  });

  it('creates 5 gate shell scripts in .reins/hooks/', () => {
    generateHooks(projectRoot);
    const hooksDir = join(projectRoot, '.reins', 'hooks');
    expect(existsSync(join(hooksDir, 'gate-context.sh'))).toBe(true);
    expect(existsSync(join(hooksDir, 'gate-pre-edit.sh'))).toBe(true);
    expect(existsSync(join(hooksDir, 'gate-post-edit.sh'))).toBe(true);
    expect(existsSync(join(hooksDir, 'gate-pre-bash.sh'))).toBe(true);
    expect(existsSync(join(hooksDir, 'gate-stop.sh'))).toBe(true);
  });

  it('each gate script contains exec reins gate <event>', () => {
    generateHooks(projectRoot);
    const hooksDir = join(projectRoot, '.reins', 'hooks');
    const contextScript = readFileSync(join(hooksDir, 'gate-context.sh'), 'utf-8');
    expect(contextScript).toContain('exec reins gate context');
    const stopScript = readFileSync(join(hooksDir, 'gate-stop.sh'), 'utf-8');
    expect(stopScript).toContain('exec reins gate stop');
  });

  it('gate scripts are executable (mode includes 0o755)', () => {
    generateHooks(projectRoot);
    const stat = statSync(join(projectRoot, '.reins', 'hooks', 'gate-context.sh'));
    expect(stat.mode & 0o100).toBe(0o100);
  });
});

describe('generateSettingsJson', () => {
  let projectRoot: string;

  beforeEach(() => { projectRoot = makeTmpDir(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  it('creates .claude/settings.json when absent', () => {
    generateSettingsJson(projectRoot, []);
    expect(existsSync(join(projectRoot, '.claude', 'settings.json'))).toBe(true);
  });

  it('always includes the protection hook entry', () => {
    generateSettingsJson(projectRoot, []);
    const raw = readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    const preToolUse = settings.hooks.PreToolUse ?? [];
    const allCommands = preToolUse.flatMap((e: { hooks: Array<{ command: string }> }) => e.hooks.map(h => h.command));
    expect(allCommands.some((c: string) => c.includes('protect-constraints.sh'))).toBe(true);
  });

  it('buckets post_edit hooks into PostToolUse', () => {
    const hooks: HookConfig[] = [
      {
        constraintId: 'no-sql',
        hookType: 'post_edit',
        scriptPath: '/tmp/no-sql.sh',
        mode: 'block',
        description: 'No SQL',
      },
    ];
    generateSettingsJson(projectRoot, hooks);
    const raw = readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw) as { hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    const postToolUse = settings.hooks.PostToolUse ?? [];
    const allCommands = postToolUse.flatMap((e: { hooks: Array<{ command: string }> }) => e.hooks.map(h => h.command));
    expect(allCommands).toContain('/tmp/no-sql.sh');
  });

  it('throws on malformed .claude/settings.json', () => {
    const claudeDir = join(projectRoot, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '{invalid json!!!', 'utf-8');

    expect(() => generateSettingsJson(projectRoot, [])).toThrow(/Cannot parse .claude\/settings.json/);
  });

  it('preserves user-managed hooks on regeneration', () => {
    // Write an existing settings.json with a user hook (no _reins marker)
    const claudeDir = join(projectRoot, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const existing = {
      hooks: {
        PostToolUse: [
          { matcher: 'Edit', hooks: [{ type: 'command', command: '/usr/local/bin/my-hook.sh' }] },
        ],
      },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existing), 'utf-8');

    generateSettingsJson(projectRoot, []);

    const raw = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw) as { hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    const postToolUse = settings.hooks.PostToolUse ?? [];
    const allCommands = postToolUse.flatMap((e: { hooks: Array<{ command: string }> }) => e.hooks.map(h => h.command));
    expect(allCommands).toContain('/usr/local/bin/my-hook.sh');
  });
});
