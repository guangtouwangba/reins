import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { setLLMProvider } from '../llm/index.js';
import { StubLLMProvider, ErrorLLMProvider } from '../llm/stub-provider.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMinimalConstraints(dir: string): void {
  const reinsDir = join(dir, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  const config = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'api' },
    stack: { primary_language: 'typescript', framework: 'none', package_manager: 'pnpm' },
    constraints: [],
    profiles: {},
  };
  writeFileSync(join(reinsDir, 'constraints.yaml'), yaml.dump(config), 'utf-8');
  // Also need snapshots dir for saveSnapshot
  mkdirSync(join(reinsDir, 'snapshots'), { recursive: true });
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => {
  setLLMProvider(null);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runHookAdd', () => {
  it('generates LLM-based hook_check when LLM is available', async () => {
    writeMinimalConstraints(tmpDir);
    const llmScript = 'INPUT=$(cat)\nif echo "$INPUT" | grep -qi "raw sql"; then\n  echo "Use ORM" >&2\n  exit 2\nfi\nexit 0';
    setLLMProvider(new StubLLMProvider(llmScript));

    // Import and run
    const { runHookAdd } = await import('./hook-cmd.js');
    await runHookAdd(tmpDir, 'no raw SQL queries');

    // Read constraints back
    const raw = readFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'utf-8');
    const config = yaml.load(raw) as { constraints: Array<{ id: string; enforcement: { hook_check: string } }> };
    const constraint = config.constraints.find(c => c.id === 'custom-no-raw-sql-queries');
    expect(constraint).toBeDefined();
    expect(constraint!.enforcement.hook_check).toContain('raw sql');
  });

  it('falls back to placeholder on LLM error', async () => {
    writeMinimalConstraints(tmpDir);
    setLLMProvider(new ErrorLLMProvider('network error'));

    const { runHookAdd } = await import('./hook-cmd.js');
    await runHookAdd(tmpDir, 'test constraint');

    const raw = readFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'utf-8');
    const config = yaml.load(raw) as { constraints: Array<{ id: string; enforcement: { hook_check: string } }> };
    const constraint = config.constraints.find(c => c.id === 'custom-test-constraint');
    expect(constraint).toBeDefined();
    expect(constraint!.enforcement.hook_check).toBe('# Hook for: test constraint');
  });
});
