import { loadConfig } from '../state/config.js';
import { scan } from '../scanner/scan.js';
import { generateConstraints, writeConstraintsFile } from '../constraints/generator.js';
import { generateContext } from '../context/index.js';
import { runAdapters, DEFAULT_ADAPTERS, ADAPTER_REGISTRY, runAdaptersV2 } from '../adapters/index.js';
import { generateHooks } from '../hooks/generator.js';
import { generateSettingsJson } from '../hooks/settings-writer.js';
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

interface SelectionItem {
  id: string;
  label: string;
  desc: string;
  selected: boolean;
  detected: boolean;
}

// Fixed line count for the selection UI (header + items + footer)
const HEADER_LINES = 2; // title + blank line
const FOOTER_LINES = 1; // blank line after items

function renderSelect(items: SelectionItem[], cursor: number): void {
  const stdout = process.stdout;
  const lines: string[] = [];
  lines.push('Which AI tools do you use? (\x1b[36m↑↓\x1b[0m move, \x1b[36mspace\x1b[0m toggle, \x1b[36menter\x1b[0m confirm)');
  lines.push('');
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const pointer = i === cursor ? '\x1b[36m❯\x1b[0m' : ' ';
    const check = item.selected ? '\x1b[32m◉\x1b[0m' : '◯';
    const det = item.detected ? ' \x1b[2m(detected)\x1b[0m' : '';
    lines.push(`  ${pointer} ${check} ${item.label.padEnd(20)} ${item.desc}${det}`);
  }
  lines.push('');
  stdout.write(lines.join('\n'));
}

async function interactiveMultiSelect(items: SelectionItem[]): Promise<string[]> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const totalLines = HEADER_LINES + items.length + FOOTER_LINES;

  let cursor = 0;

  // Hide cursor and render initial state
  stdout.write('\x1b[?25l'); // hide cursor
  renderSelect(items, cursor);

  return new Promise<string[]>((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    const cleanup = () => {
      stdout.write('\x1b[?25h'); // show cursor
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const redraw = () => {
      // Move to start of our UI block and clear it
      stdout.write(`\x1b[${totalLines - 1}F`); // move up to start of our UI block
      stdout.write('\x1b[J');               // clear from cursor to end of screen
      renderSelect(items, cursor);
    };

    const onData = (key: string) => {
      if (key === '\x03') { cleanup(); process.exit(0); }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(items.filter(i => i.selected).map(i => i.id));
        return;
      }
      if (key === ' ') {
        items[cursor]!.selected = !items[cursor]!.selected;
        redraw();
        return;
      }
      if (key === '\x1b[A' || key === 'k') {
        cursor = cursor > 0 ? cursor - 1 : items.length - 1;
        redraw();
        return;
      }
      if (key === '\x1b[B' || key === 'j') {
        cursor = cursor < items.length - 1 ? cursor + 1 : 0;
        redraw();
        return;
      }
      if (key === 'a') {
        const allSelected = items.every(i => i.selected);
        for (const i of items) i.selected = !allSelected;
        redraw();
        return;
      }
    };

    stdin.on('data', onData);
  });
}

async function selectAdapters(projectRoot: string, options: InitOptions, config: ReturnType<typeof loadConfig>): Promise<string[]> {
  // Explicit --adapters flag takes priority
  if (options.adapters) {
    return options.adapters.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Auto-detect installed tools
  const detectedSet = new Set(
    ADAPTER_REGISTRY.filter(a => a.detect(projectRoot)).map(a => a.id),
  );

  // If already configured, use as pre-selection hints but still allow changing
  const savedEnabled = config.adapters?.enabled ?? [];
  if (savedEnabled.length > 0) {
    for (const id of savedEnabled) detectedSet.add(id);
  }

  // Non-interactive: use detected or default to claude-code
  if (options.noInput || !process.stdin.isTTY) {
    return detectedSet.size > 0 ? [...detectedSet] : ['claude-code'];
  }

  // Interactive multi-select with arrow keys + space + enter
  const selections = ADAPTER_REGISTRY.map(a => ({
    id: a.id,
    label: a.displayName,
    desc: a.description,
    selected: detectedSet.has(a.id) || a.id === 'claude-code',
    detected: detectedSet.has(a.id),
  }));

  const result = await interactiveMultiSelect(selections);

  // Show final selection
  console.log('');
  console.log('Selected:');
  for (const s of selections.filter(s => s.selected)) {
    console.log(`  ✓ ${s.label} ${s.desc}`);
  }
  console.log('');

  return result.length > 0 ? result : ['claude-code'];
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
  const adapterIds = await selectAdapters(projectRoot, options, config);

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

  // 8. Generate hooks and register in .claude/settings.json
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');
  const hookConfigs = generateHooks(projectRoot, constraintsPath);
  generateSettingsJson(projectRoot, hookConfigs);
  console.log(`  ✓ ${hookConfigs.length} hooks generated`);

  // Skill indexing
  if (!options.dryRun && config.skills?.enabled) {
    const { buildSkillIndex, saveSkillIndex } = await import('../scanner/skill-indexer.js');
    const skillIndex = buildSkillIndex(projectRoot, config.skills.sources ?? []);
    saveSkillIndex(projectRoot, skillIndex);
    if (skillIndex.skills.length > 0) {
      console.log(`  ✓ ${skillIndex.skills.length} skills indexed`);
    }
  }

  // Print summary
  console.log('  Generated files:');
  console.log('  ✓ .reins/constraints.yaml');
  console.log('  ✓ .claude/settings.json');
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
