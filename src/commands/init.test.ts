import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { initCommand } from './init.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  // Minimal project fixtures
  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0', devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' } }),
    'utf-8',
  );
  writeFileSync(
    join(tmpDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext' } }),
    'utf-8',
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('initCommand', () => {
  it('creates .reins/constraints.yaml with valid YAML', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2' });

    const constraintsPath = join(tmpDir, '.reins', 'constraints.yaml');
    expect(existsSync(constraintsPath)).toBe(true);

    const raw = readFileSync(constraintsPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed).toBeTruthy();
    expect(parsed['version']).toBe(1);
    expect(Array.isArray(parsed['constraints'])).toBe(true);
  });

  it('creates CLAUDE.md with fewer than 50 lines', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2' });

    const claudeMdPath = join(tmpDir, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);

    const content = readFileSync(claudeMdPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(50);
  });

  it('ships the full set of reins slash commands into .claude/commands/reins/', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2' });

    const commandsDir = join(tmpDir, '.claude', 'commands', 'reins');
    expect(existsSync(commandsDir)).toBe(true);

    // Each workflow registered in getWorkflows() should land as one
    // .md file under .claude/commands/reins/. Matching against the
    // live registry (rather than a hard-coded count) keeps this test
    // in sync whenever workflows are added.
    const { getWorkflows } = await import('../workflows/index.js');
    const workflows = getWorkflows();

    for (const workflow of workflows) {
      const commandPath = join(commandsDir, `${workflow.id}.md`);
      expect(existsSync(commandPath), `missing slash command: ${workflow.id}`).toBe(true);
      const content = readFileSync(commandPath, 'utf-8');
      expect(content).toContain(`name: ${workflow.name}`);
      expect(content).toContain(workflow.body.split('\n')[0]);
    }

    // setup, add-constraint, verify, learn, update, feature-new, ship, ship-here.
    expect(workflows.length).toBe(8);
  });

  it('creates an empty .reins/features/ directory for the ship queue', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2' });
    const featuresDir = join(tmpDir, '.reins', 'features');
    expect(existsSync(featuresDir)).toBe(true);
  });

  it('dry-run creates zero files (.reins/ and adapter outputs)', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2', dryRun: true });

    // No adapter outputs
    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
    // No constraints file
    expect(existsSync(join(tmpDir, '.reins', 'constraints.yaml'))).toBe(false);
    // scan() should also not write context.json / manifest.json / patterns.json
    expect(existsSync(join(tmpDir, '.reins', 'context.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.reins', 'manifest.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.reins', 'patterns.json'))).toBe(false);
  });
});
