import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { parseGateInput, isProtectedPath, loadConstraints } from './shared.js';
import { gateContext } from './context.js';
import { gatePreEdit } from './pre-edit.js';
import { gatePostEdit } from './post-edit.js';
import { gatePreBash } from './pre-bash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface ConstraintOverride {
  id?: string;
  rule?: string;
  severity?: string;
  scope?: string;
  source?: string;
  enforcement?: {
    soft?: boolean;
    hook?: boolean;
    hook_type?: string;
    hook_mode?: string;
    hook_check?: string;
  };
}

function makeConstraintsYaml(dir: string, constraints: ConstraintOverride[]): void {
  const config = {
    version: 1,
    generated_at: '2026-04-02T00:00:00.000Z',
    project: { name: 'test', type: 'library' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints,
    pipeline: { pre_commit: [] },
  };
  const reinsDir = join(dir, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  writeFileSync(join(reinsDir, 'constraints.yaml'), yaml.dump(config), 'utf-8');
}

const BASE_CONSTRAINT: ConstraintOverride = {
  id: 'no-try-catch',
  rule: 'Use Result type, not try/catch',
  severity: 'critical',
  scope: 'global',
  source: 'auto',
  enforcement: {
    soft: false,
    hook: true,
    hook_type: 'post_edit',
    hook_mode: 'block',
    hook_check: 'try\\s*\\{',
  },
};

// ---------------------------------------------------------------------------
// shared.ts — parseGateInput
// ---------------------------------------------------------------------------

describe('parseGateInput', () => {
  afterEach(() => {
    delete process.env.CLAUDE_TOOL_INPUT;
  });

  it('returns empty object when CLAUDE_TOOL_INPUT is not set', () => {
    delete process.env.CLAUDE_TOOL_INPUT;
    const result = parseGateInput();
    expect(result).toEqual({});
  });

  it('parses valid JSON from CLAUDE_TOOL_INPUT', () => {
    process.env.CLAUDE_TOOL_INPUT = JSON.stringify({ file_path: 'src/index.ts', new_string: 'hello' });
    const result = parseGateInput();
    expect(result.file_path).toBe('src/index.ts');
    expect(result.new_string).toBe('hello');
  });

  it('returns empty object for invalid JSON in CLAUDE_TOOL_INPUT', () => {
    process.env.CLAUDE_TOOL_INPUT = '{not valid json!!!';
    const result = parseGateInput();
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// shared.ts — isProtectedPath
// ---------------------------------------------------------------------------

describe('isProtectedPath', () => {
  it('returns true for .reins/constraints.yaml', () => {
    expect(isProtectedPath('.reins/constraints.yaml')).toBe(true);
  });

  it('returns true for .reins/hooks/gate-stop.sh', () => {
    expect(isProtectedPath('.reins/hooks/gate-stop.sh')).toBe(true);
  });

  it('returns false for src/index.ts', () => {
    expect(isProtectedPath('src/index.ts')).toBe(false);
  });

  it('returns true for .claude/settings.json (exact match)', () => {
    expect(isProtectedPath('.claude/settings.json')).toBe(true);
  });

  it('returns false for src/components/button.tsx', () => {
    expect(isProtectedPath('src/components/button.tsx')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shared.ts — loadConstraints
// ---------------------------------------------------------------------------

describe('loadConstraints', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty array when no constraints.yaml exists', () => {
    const result = loadConstraints(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns constraints array when constraints.yaml is present', () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const result = loadConstraints(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('no-try-catch');
  });
});

// ---------------------------------------------------------------------------
// context.ts — gateContext
// ---------------------------------------------------------------------------

describe('gateContext', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns allow with empty messages when prompt is empty', async () => {
    const result = await gateContext(tmpDir, {});
    expect(result.action).toBe('allow');
    expect(result.messages).toHaveLength(0);
  });

  it('includes constraint summary when constraints exist and prompt is provided', async () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const result = await gateContext(tmpDir, { prompt: 'implement the feature' });
    expect(result.action).toBe('allow');
    const joined = result.messages.join('\n');
    expect(joined).toContain('[Reins Constraints]');
    expect(joined).toContain('Use Result type, not try/catch');
  });

  it('returns allow with empty messages when prompt is empty even with constraints', async () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const result = await gateContext(tmpDir, { prompt: '' });
    expect(result.action).toBe('allow');
    expect(result.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pre-edit.ts — gatePreEdit
// ---------------------------------------------------------------------------

describe('gatePreEdit', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('blocks edits to .reins/constraints.yaml', async () => {
    const result = await gatePreEdit(tmpDir, { file_path: '.reins/constraints.yaml', new_string: 'something' });
    expect(result.action).toBe('block');
    expect(result.blockReason).toContain('.reins/constraints.yaml');
    expect(result.blockReason).toContain('protected');
  });

  it('allows edits to normal files with no constraints', async () => {
    const result = await gatePreEdit(tmpDir, { file_path: 'src/index.ts', new_string: 'const x = 1;' });
    expect(result.action).toBe('allow');
  });

  it('blocks when new_string matches constraint hook_check in block mode', async () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const result = await gatePreEdit(tmpDir, {
      file_path: 'src/service.ts',
      new_string: 'try { doSomething(); } catch (e) {}',
    });
    expect(result.action).toBe('block');
    expect(result.blockReason).toContain('no-try-catch');
    expect(result.blockReason).toContain('Use Result type, not try/catch');
  });

  it('warns when new_string matches constraint hook_check in warn mode', async () => {
    const warnConstraint = {
      ...BASE_CONSTRAINT,
      enforcement: { ...BASE_CONSTRAINT.enforcement, hook_mode: 'warn' },
    };
    makeConstraintsYaml(tmpDir, [warnConstraint]);
    const result = await gatePreEdit(tmpDir, {
      file_path: 'src/service.ts',
      new_string: 'try { doSomething(); } catch (e) {}',
    });
    expect(result.action).toBe('allow');
    expect(result.messages.join('\n')).toContain('reins [warn] no-try-catch');
  });

  it('allows edits when new_string does not match constraint pattern', async () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const result = await gatePreEdit(tmpDir, {
      file_path: 'src/service.ts',
      new_string: 'const result = safeOp();',
    });
    expect(result.action).toBe('allow');
    expect(result.messages).toHaveLength(0);
  });

  it('returns allow when no file_path is provided', async () => {
    const result = await gatePreEdit(tmpDir, {});
    expect(result.action).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// post-edit.ts — gatePostEdit
// ---------------------------------------------------------------------------

describe('gatePostEdit', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns allow when file does not exist', async () => {
    const result = await gatePostEdit(tmpDir, { file_path: 'src/nonexistent.ts' });
    expect(result.action).toBe('allow');
  });

  it('blocks when file content matches constraint in block mode', async () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'service.ts'), 'try { doSomething(); } catch (e) {}', 'utf-8');

    const result = await gatePostEdit(tmpDir, { file_path: 'src/service.ts' });
    expect(result.action).toBe('block');
    expect(result.blockReason).toContain('no-try-catch');
    expect(result.blockReason).toContain('src/service.ts');
  });

  it('allows when file content does not match constraint', async () => {
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'service.ts'), 'const result = safeOp();', 'utf-8');

    const result = await gatePostEdit(tmpDir, { file_path: 'src/service.ts' });
    expect(result.action).toBe('allow');
  });

  it('respects directory scope — skips constraint for files outside scope', async () => {
    const scopedConstraint: ConstraintOverride = {
      ...BASE_CONSTRAINT,
      id: 'no-try-catch-in-lib',
      scope: 'directory:lib/',
    };
    makeConstraintsYaml(tmpDir, [scopedConstraint]);
    // File is in src/, not lib/ — constraint should not apply
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'service.ts'), 'try { doSomething(); } catch (e) {}', 'utf-8');

    const result = await gatePostEdit(tmpDir, { file_path: 'src/service.ts' });
    expect(result.action).toBe('allow');
  });

  it('applies directory-scoped constraint to files inside scope', async () => {
    const scopedConstraint: ConstraintOverride = {
      ...BASE_CONSTRAINT,
      id: 'no-try-catch-in-src',
      scope: 'directory:src/',
    };
    makeConstraintsYaml(tmpDir, [scopedConstraint]);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'service.ts'), 'try { doSomething(); } catch (e) {}', 'utf-8');

    const result = await gatePostEdit(tmpDir, { file_path: 'src/service.ts' });
    expect(result.action).toBe('block');
  });

  it('returns allow when no file_path is provided', async () => {
    const result = await gatePostEdit(tmpDir, {});
    expect(result.action).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// pre-bash.ts — gatePreBash
// ---------------------------------------------------------------------------

describe('gatePreBash', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('blocks matching dangerous command', async () => {
    const bashConstraint: ConstraintOverride = {
      id: 'no-rm-rf',
      rule: 'Do not run rm -rf',
      severity: 'critical',
      scope: 'global',
      source: 'auto',
      enforcement: {
        soft: false,
        hook: true,
        hook_type: 'pre_bash',
        hook_mode: 'block',
        hook_check: 'rm\\s+-rf',
      },
    };
    makeConstraintsYaml(tmpDir, [bashConstraint]);

    const result = await gatePreBash(tmpDir, { command: 'rm -rf /tmp/something' });
    expect(result.action).toBe('block');
    expect(result.blockReason).toContain('no-rm-rf');
    expect(result.blockReason).toContain('Do not run rm -rf');
  });

  it('allows safe commands', async () => {
    const bashConstraint: ConstraintOverride = {
      id: 'no-rm-rf',
      rule: 'Do not run rm -rf',
      severity: 'critical',
      scope: 'global',
      source: 'auto',
      enforcement: {
        soft: false,
        hook: true,
        hook_type: 'pre_bash',
        hook_mode: 'block',
        hook_check: 'rm\\s+-rf',
      },
    };
    makeConstraintsYaml(tmpDir, [bashConstraint]);

    const result = await gatePreBash(tmpDir, { command: 'pnpm test' });
    expect(result.action).toBe('allow');
  });

  it('returns allow when no command is provided', async () => {
    const result = await gatePreBash(tmpDir, {});
    expect(result.action).toBe('allow');
  });

  it('ignores post_edit constraints for bash commands', async () => {
    // BASE_CONSTRAINT is hook_type: post_edit — should not fire for pre-bash gate
    makeConstraintsYaml(tmpDir, [BASE_CONSTRAINT]);
    const result = await gatePreBash(tmpDir, { command: 'try { something }' });
    expect(result.action).toBe('allow');
  });
});
