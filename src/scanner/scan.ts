import type { CodebaseContext } from './types.js';
import type { ReinsConfig } from '../state/config.js';
import { emptyCodebaseContext } from './types.js';
import { scanDirectory } from './directory-scanner.js';
import { detectStack } from './stack-detector.js';
import { detectTests } from './test-detector.js';
import { detectRules } from './rule-detector.js';
import { analyzePatterns } from './pattern-analyzer.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type ScanDepth = 'L0' | 'L0-L1' | 'L0-L2';

export async function scan(
  projectRoot: string,
  depth: ScanDepth = 'L0-L2',
  config?: ReinsConfig,
): Promise<CodebaseContext> {
  const excludeDirs = [
    'node_modules', '.git', 'dist', 'build', 'vendor', 'generated',
    ...(config?.scan.exclude_dirs ?? []),
  ];

  const context = emptyCodebaseContext();

  // Always run L0: directory scan + basic stack detection
  const { files, directories, manifest } = await scanDirectory(projectRoot, excludeDirs);
  context.structure = { directories, files };

  const filePaths = files.map(f => f.path);
  const dirPaths = directories.map(d => d.path);

  // L0: signal-based detection
  const stackL0 = detectStack(filePaths, projectRoot, 'L0');
  Object.assign(context.stack, stackL0);

  const testingL0 = detectTests(filePaths, projectRoot, 'L0');
  Object.assign(context.testing, testingL0);

  // Detect key files
  context.keyFiles = {
    readme: filePaths.find(f => /^readme/i.test(f.split('/').pop() ?? '')) ?? null,
    contributing: filePaths.find(f => /^contributing/i.test(f.split('/').pop() ?? '')) ?? null,
    changelog: filePaths.find(f => /^changelog/i.test(f.split('/').pop() ?? '')) ?? null,
    lockfile: filePaths.find(f => /lock\.(yaml|json)$|\.lock$/.test(f)) ?? null,
  };

  // L1: config file parsing
  if (depth === 'L0-L1' || depth === 'L0-L2') {
    const stackL1 = detectStack(filePaths, projectRoot, 'L1');
    mergePartial(context.stack, stackL1);

    const testingL1 = detectTests(filePaths, projectRoot, 'L1');
    mergePartial(context.testing, testingL1);

    context.existingRules = detectRules(filePaths, projectRoot);
  }

  // L2: pattern analysis
  if (depth === 'L0-L2') {
    const patterns = analyzePatterns(filePaths, dirPaths);
    mergePartial(context.architecture, patterns.architecture);
    mergePartial(context.conventions, patterns.conventions);
  }

  // Write output artifacts
  const reinsDir = join(projectRoot, '.reins');
  if (!existsSync(reinsDir)) mkdirSync(reinsDir, { recursive: true });

  writeFileSync(join(reinsDir, 'context.json'), JSON.stringify(context, null, 2));
  writeFileSync(join(reinsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(reinsDir, 'patterns.json'), JSON.stringify({
    stack: context.stack,
    architecture: context.architecture,
    conventions: context.conventions,
  }, null, 2));

  return context;
}

function mergePartial<T>(target: T, source: Partial<T>): void {
  for (const key of Object.keys(source as object) as (keyof T)[]) {
    const val = source[key];
    if (val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0)) {
      (target as Record<string, unknown>)[key as string] = val;
    }
  }
}
