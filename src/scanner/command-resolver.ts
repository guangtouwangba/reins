import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandMap, ResolvedCommand } from './types.js';

/** Resolve commands for a JS/TS project by reading package.json scripts */
export function resolveCommands(contextRoot: string, packageManager: string): Partial<Record<keyof CommandMap, ResolvedCommand>> {
  const result: Partial<Record<keyof CommandMap, ResolvedCommand>> = {};
  const pmRun = packageManager === 'npm' ? 'npm run' : packageManager === 'yarn' ? 'yarn' : `${packageManager} run`;
  const pm = packageManager;

  // Read package.json scripts
  const pkgPath = join(contextRoot, 'package.json');
  if (!existsSync(pkgPath)) return result;

  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    scripts = pkg.scripts ?? {};
  } catch {
    return result;
  }

  // Map scripts to CommandMap fields
  const scriptMap: Array<{ field: keyof CommandMap; candidates: string[] }> = [
    { field: 'dev', candidates: ['dev', 'start', 'serve'] },
    { field: 'build', candidates: ['build', 'compile'] },
    { field: 'lint', candidates: ['lint', 'lint:check', 'eslint'] },
    { field: 'lintFix', candidates: ['lint:fix', 'fix', 'eslint:fix'] },
    { field: 'test', candidates: ['test', 'test:run', 'vitest', 'jest'] },
    { field: 'typecheck', candidates: ['typecheck', 'type-check', 'tsc', 'check-types'] },
    { field: 'format', candidates: ['format', 'prettier', 'fmt'] },
    { field: 'formatCheck', candidates: ['format:check', 'prettier:check'] },
    { field: 'clean', candidates: ['clean'] },
  ];

  for (const { field, candidates } of scriptMap) {
    for (const candidate of candidates) {
      if (scripts[candidate]) {
        result[field] = { command: `${pmRun} ${candidate}`, source: 'script', confidence: 1.0 };
        break;
      }
    }
  }

  // Install command
  result['install'] = { command: `${pm} install`, source: 'convention', confidence: 1.0 };

  // Derive lintFix if not found and lint script contains eslint
  if (!result.lintFix && result.lint && scripts['lint']?.includes('eslint')) {
    result.lintFix = { command: `${pmRun} lint -- --fix`, source: 'script', confidence: 0.8 };
  }

  // Derive testSingle if test script contains vitest or jest
  if (!result.testSingle) {
    const testScript = scripts['test'] ?? '';
    if (testScript.includes('vitest')) {
      result.testSingle = { command: `${pm} vitest run {file}`, source: 'script', confidence: 0.9 };
    } else if (testScript.includes('jest')) {
      result.testSingle = { command: `${pm} jest {file}`, source: 'script', confidence: 0.9 };
    }
  }

  return result;
}

/** Merge multiple command sources with priority: later overrides earlier for non-null fields */
export function mergeCommands(
  base: CommandMap,
  ...layers: Array<Partial<Record<keyof CommandMap, ResolvedCommand>> | null | undefined>
): CommandMap {
  const result = { ...base };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer) as Array<[keyof CommandMap, ResolvedCommand | null]>) {
      if (value) {
        result[key] = value;
      }
    }
  }
  return result;
}
