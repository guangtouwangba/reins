import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import type { L0Result, CommandResult, DetectedCommands } from './types.js';

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

function detectPackageManager(projectRoot: string): string {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// ---------------------------------------------------------------------------
// Script detection
// ---------------------------------------------------------------------------

function findScript(
  scripts: Record<string, string>,
  candidates: string[],
): { key: string; value: string } | null {
  for (const key of candidates) {
    const value = scripts[key];
    if (value && !value.trim().startsWith('echo') && value.trim() !== '') {
      return { key, value };
    }
  }
  return null;
}

export function detectCommands(projectRoot: string): DetectedCommands {
  const packageManager = detectPackageManager(projectRoot);
  const pm = packageManager;
  const pmRun = pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : `${pm} run`;

  const pkgPath = join(projectRoot, 'package.json');
  let scripts: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      scripts = pkg.scripts ?? {};
    } catch {
      scripts = {};
    }
  }

  const lintMatch = findScript(scripts, ['lint', 'lint:check', 'eslint']);
  const typecheckMatch = findScript(scripts, ['typecheck', 'type-check', 'tsc', 'check']);
  const testMatch = findScript(scripts, ['test', 'test:ci', 'vitest', 'jest']);

  return {
    packageManager,
    lint: lintMatch
      ? { command: `${pmRun} ${lintMatch.key}`, scriptKey: lintMatch.key }
      : { command: null, scriptKey: null },
    typecheck: typecheckMatch
      ? { command: `${pmRun} ${typecheckMatch.key}`, scriptKey: typecheckMatch.key }
      : { command: null, scriptKey: null },
    test: testMatch
      ? { command: `${pmRun} ${testMatch.key}`, scriptKey: testMatch.key }
      : { command: null, scriptKey: null },
  };
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

export function runCommand(
  name: 'lint' | 'typecheck' | 'test',
  command: string,
  cwd: string,
): Promise<CommandResult> {
  const start = Date.now();
  return new Promise(resolve => {
    exec(command, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = error?.code ?? 0;
      resolve({
        name,
        command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        skipped: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// L0 entry point
// ---------------------------------------------------------------------------

export async function runL0Static(
  projectRoot: string,
  opts: { failFast?: boolean } = {},
): Promise<L0Result> {
  const failFast = opts.failFast ?? true;
  const detected = detectCommands(projectRoot);
  const categories: Array<{ name: 'lint' | 'typecheck' | 'test'; command: string | null }> = [
    { name: 'lint', command: detected.lint.command },
    { name: 'typecheck', command: detected.typecheck.command },
    { name: 'test', command: detected.test.command },
  ];

  const commands: CommandResult[] = [];
  let passed = true;

  for (const { name, command } of categories) {
    if (!command) {
      commands.push({
        name,
        command: '',
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        skipped: true,
      });
      continue;
    }

    const result = await runCommand(name, command, projectRoot);
    commands.push(result);

    if (result.exitCode !== 0) {
      passed = false;
      if (failFast) break;
    }
  }

  return {
    passed,
    commands,
    detectedPackageManager: detected.packageManager,
  };
}
