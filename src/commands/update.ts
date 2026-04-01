import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { buildManifest, loadManifest, diffManifest, saveManifest } from '../state/manifest.js';
import { saveSnapshot } from '../state/snapshot.js';
import { mergeConstraints } from '../constraints/merger.js';
import type { ConstraintsConfig, Constraint } from '../constraints/schema.js';

export async function runUpdate(options: { autoApply?: boolean }): Promise<void> {
  const projectRoot = process.cwd();
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');

  if (!existsSync(constraintsPath)) {
    console.log('No .reins/constraints.yaml found. Run `reins init` first.');
    return;
  }

  // Build and diff manifests
  const prevManifest = loadManifest(projectRoot);
  const currManifest = buildManifest(projectRoot);

  if (prevManifest) {
    const diff = diffManifest(prevManifest, currManifest);
    if (!diff.hasChanges) {
      console.log('Nothing changed — manifest is up to date.');
      return;
    }
    console.log(`Changes detected: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified`);
  } else {
    console.log('No previous manifest found — performing full scan.');
  }

  // Load existing constraints
  const raw = readFileSync(constraintsPath, 'utf-8');
  const config = yaml.load(raw) as ConstraintsConfig;
  const existing: Constraint[] = config.constraints ?? [];

  // Re-scan (dynamic import to avoid circular deps in tests)
  const { scan } = await import('../scanner/scan.js');
  const { generateConstraints } = await import('../constraints/generator.js');
  const { loadConfig } = await import('../state/config.js');

  const reinsConfig = loadConfig(projectRoot);
  const context = await scan(projectRoot, 'L0-L2', reinsConfig);
  const incoming = generateConstraints(context, projectRoot);

  // Merge
  const result = mergeConstraints(existing, incoming);

  console.log('');
  console.log('Merge result:');
  console.log(`  Kept:       ${result.kept.length}`);
  console.log(`  Added:      ${result.added.length}`);
  console.log(`  Deprecated: ${result.deprecated.length}`);
  console.log(`  Conflicts:  ${result.conflicts.length}`);

  if (result.added.length > 0) {
    console.log('');
    console.log('New constraints:');
    for (const c of result.added) {
      console.log(`  + [${c.severity}] ${c.id}: ${c.rule.slice(0, 80)}`);
    }
  }

  if (result.deprecated.length > 0) {
    console.log('');
    console.log('Deprecated constraints:');
    for (const c of result.deprecated) {
      console.log(`  - ${c.id}: ${c.rule.slice(0, 80)}`);
    }
  }

  if (result.conflicts.length > 0) {
    console.log('');
    console.log('Conflicts (manual resolution required):');
    for (const cp of result.conflicts) {
      console.log(`  ! ${cp.existing.id}`);
      console.log(`    existing:  ${cp.existing.rule.slice(0, 60)}`);
      console.log(`    incoming:  ${cp.incoming.rule.slice(0, 60)}`);
    }
  }

  const shouldApply = options.autoApply || result.conflicts.length === 0;

  if (!shouldApply) {
    console.log('');
    console.log('Conflicts found — use --auto-apply to apply non-conflicting changes, or resolve conflicts manually.');
    return;
  }

  // Auto-apply: apply all non-conflicting changes (conflicts are already excluded from `result.added`)
  const autoApplyFilter = () => true;

  // Compose final constraint list
  const finalConstraints: Constraint[] = [
    ...result.kept,
    ...result.added.filter(autoApplyFilter),
    ...result.deprecated,
    // Keep existing sides of conflicts
    ...result.conflicts.map(cp => cp.existing),
  ];

  // Save snapshot before writing
  saveSnapshot(projectRoot, 'update');

  // Write updated constraints
  const { writeConstraintsFile } = await import('../constraints/generator.js');
  writeConstraintsFile(projectRoot, finalConstraints, context);

  // Regenerate adapter files using saved selection
  const { ADAPTER_REGISTRY, runAdaptersV2 } = await import('../adapters/index.js');
  const enabledAdapters = reinsConfig.adapters?.enabled ?? [];
  const adapterIds = enabledAdapters.length > 0 ? enabledAdapters : ['claude-code'];
  if (ADAPTER_REGISTRY.length > 0) {
    runAdaptersV2(projectRoot, finalConstraints, context, config, adapterIds);
  }

  // Rebuild manifest after writes so next update sees correct baseline
  const postWriteManifest = buildManifest(projectRoot);
  saveManifest(projectRoot, postWriteManifest);

  console.log('');
  console.log(`Updated .reins/constraints.yaml (${finalConstraints.length} constraints).`);
}
