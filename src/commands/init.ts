import { loadConfig } from '../state/config.js';
import { scan } from '../scanner/scan.js';
import { generateConstraints, writeConstraintsFile } from '../constraints/generator.js';
import { generateContext } from '../context/index.js';
import { runAdapters, DEFAULT_ADAPTERS, ADAPTER_REGISTRY, runAdaptersV2 } from '../adapters/index.js';
import type { ConstraintsConfig } from '../constraints/schema.js';
import type { ScanDepth } from '../scanner/scan.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface InitOptions {
  depth: string;
  dryRun?: boolean;
  adapters?: string;
  noInput?: boolean;
}

function selectAdapters(projectRoot: string, options: InitOptions, config: ReturnType<typeof loadConfig>): string[] {
  // Explicit --adapters flag takes priority
  if (options.adapters) {
    return options.adapters.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Check if already configured
  if (config.adapters?.enabled?.length > 0) {
    return config.adapters.enabled;
  }

  // Auto-detect installed tools
  const detected = ADAPTER_REGISTRY
    .filter(a => a.detect(projectRoot))
    .map(a => a.id);

  // Non-interactive: use detected or default to claude-code
  if (options.noInput || !process.stdin.isTTY) {
    return detected.length > 0 ? detected : ['claude-code'];
  }

  // Interactive mode: for now, use detected + claude-code as default
  // Real interactive multi-select would use @inquirer/prompts
  const selected = new Set(detected);
  selected.add('claude-code'); // always include claude-code by default
  return [...selected];
}

export async function initCommand(projectRoot: string, options: InitOptions): Promise<void> {
  const depth = (options.depth as ScanDepth) ?? 'L0-L2';

  console.log('Reins: Scanning project...');

  // 1. Load config
  const config = loadConfig(projectRoot);

  // 2. Scan
  const context = await scan(projectRoot, depth, config, { dryRun: options.dryRun });

  // 3. Generate constraints
  const constraints = generateConstraints(context, projectRoot);

  // 4. Build ConstraintsConfig (mirrors writeConstraintsFile logic)
  const packageManager = context.stack.packageManager || 'npm';
  const pmRun =
    packageManager === 'npm' ? 'npm run' : packageManager === 'yarn' ? 'yarn' : `${packageManager} run`;

  const constraintsConfig: ConstraintsConfig = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: {
      name: projectRoot.split('/').pop() ?? 'project',
      type: context.architecture.pattern,
    },
    stack: {
      primary_language: context.stack.language[0] ?? 'unknown',
      framework: context.stack.framework[0] ?? 'none',
      test_framework: context.stack.testFramework,
      package_manager: packageManager,
    },
    constraints,
    pipeline: {
      planning: 'ultrathink',
      execution: 'default',
      verification: { engine: 'reins', max_iterations: 3 },
      qa: true,
      pre_commit: [`${pmRun} lint`, `${pmRun} typecheck`],
      post_develop: [`${pmRun} test`],
    },
    profiles: {
      strict: {
        constraints: ['critical', 'important', 'helpful'],
        hooks: ['critical', 'important'],
        pipeline: ['planning', 'execution', 'verification', 'qa'],
        output_format: 'detailed',
      },
      default: {
        constraints: ['critical', 'important'],
        hooks: ['critical'],
        pipeline: ['execution', 'verification'],
      },
      relaxed: {
        constraints: ['critical'],
        hooks: [],
        pipeline: ['execution'],
      },
      ci: {
        constraints: ['critical', 'important', 'helpful'],
        hooks: ['critical', 'important'],
        pipeline: ['execution', 'verification', 'qa'],
        output_format: 'json',
      },
    },
  };

  // Print stack summary
  const stackParts = [...context.stack.framework, ...context.stack.language, context.stack.packageManager]
    .filter(Boolean)
    .join(' + ');
  console.log(`  ✓ Stack: ${stackParts || 'unknown'}`);
  console.log(`  ✓ Architecture: ${context.architecture.pattern || 'unknown'}`);
  if (context.testing.framework) {
    console.log(`  ✓ Testing: ${context.testing.framework}${context.testing.pattern ? ` (${context.testing.pattern})` : ''}`);
  }

  const critical = constraints.filter(c => c.severity === 'critical').length;
  const important = constraints.filter(c => c.severity === 'important').length;
  const helpful = constraints.filter(c => c.severity === 'helpful').length;
  console.log(
    `  ✓ Constraints: ${constraints.length} generated (${critical} critical, ${important} important, ${helpful} helpful)`,
  );
  console.log('');

  if (options.dryRun) {
    console.log('  Dry run — no files written.');
    console.log('');
    console.log('  Would generate:');
    console.log('  ✓ .reins/constraints.yaml');
    for (const adapter of DEFAULT_ADAPTERS) {
      console.log(`  ✓ ${adapter.outputPath}`);
    }
    console.log('');
    return;
  }

  // 5. Write constraints file
  writeConstraintsFile(projectRoot, constraints, context);

  // 6. Generate context files (L0/L1/L2)
  generateContext(projectRoot, constraints, context, depth);

  // 7. Select adapters
  const adapterIds = selectAdapters(projectRoot, options, config);

  // Save adapter selection to config
  if (!options.dryRun) {
    const configDir = join(projectRoot, '.reins');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.yaml');
    const existingConfig = existsSync(configPath)
      ? yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown> ?? {}
      : {};
    existingConfig['adapters'] = { enabled: adapterIds };
    writeFileSync(configPath, yaml.dump(existingConfig, { lineWidth: 120 }), 'utf-8');
  }

  // Run V2 adapters
  const adapterResults = runAdaptersV2(projectRoot, constraints, context, constraintsConfig, adapterIds);

  // 8. Print summary
  console.log('  Generated files:');
  console.log('  ✓ .reins/constraints.yaml');
  for (const result of adapterResults) {
    if (result.written) {
      console.log(`  ✓ ${result.path.replace(projectRoot + '/', '')}`);
    }
  }
  console.log('');
  console.log('  Reins initialized successfully.');
  console.log('');
  console.log('  Next steps:');
  console.log('    reins status   — view constraint summary');
  console.log('    reins test     — verify hooks are healthy');
  console.log('    reins update   — update after project changes');
}
