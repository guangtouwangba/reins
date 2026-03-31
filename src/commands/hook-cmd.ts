import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { saveSnapshot } from '../state/snapshot.js';
import type { ConstraintsConfig } from '../constraints/schema.js';

function loadConstraintsConfig(projectRoot: string): ConstraintsConfig | null {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return yaml.load(raw) as ConstraintsConfig;
  } catch {
    return null;
  }
}

function saveConstraintsConfig(projectRoot: string, config: ConstraintsConfig): void {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  writeFileSync(path, yaml.dump(config, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

export async function runHookList(projectRoot: string): Promise<void> {
  const hooksDir = join(projectRoot, '.reins', 'hooks');
  const config = loadConstraintsConfig(projectRoot);

  let hookFiles: string[] = [];
  if (existsSync(hooksDir)) {
    try {
      hookFiles = readdirSync(hooksDir).filter(f => f.endsWith('.sh'));
    } catch { /* ignore */ }
  }

  if (hookFiles.length === 0 && (!config || config.constraints.every(c => !c.enforcement.hook))) {
    console.log('No hooks configured.');
    return;
  }

  console.log(`${'Hook ID'.padEnd(35)} ${'Type'.padEnd(15)} ${'Mode'.padEnd(8)} ${'Status'.padEnd(10)} Last Triggered`);
  console.log('-'.repeat(85));

  const hooksWithConstraints = new Set<string>();

  if (config) {
    for (const c of config.constraints) {
      if (!c.enforcement.hook) continue;
      hooksWithConstraints.add(c.id);

      const hookFile = join(hooksDir, `${c.id}.sh`);
      const fileExists = existsSync(hookFile);
      const mode = c.enforcement.hook_mode ?? 'block';
      const status = !fileExists ? 'missing' : mode === 'off' ? 'disabled' : 'active';
      const hookType = c.enforcement.hook_type ?? 'unknown';

      console.log(`${c.id.padEnd(35)} ${hookType.padEnd(15)} ${mode.padEnd(8)} ${status.padEnd(10)} —`);
    }
  }

  // Show orphan hook files (no corresponding constraint)
  for (const f of hookFiles) {
    const hookId = f.replace('.sh', '');
    if (!hooksWithConstraints.has(hookId)) {
      try {
        const s = statSync(join(hooksDir, f));
        const exec = (s.mode & 0o111) !== 0 ? 'active' : 'not-exec';
        console.log(`${hookId.padEnd(35)} ${'unknown'.padEnd(15)} ${'—'.padEnd(8)} ${exec.padEnd(10)} —`);
      } catch { /* skip */ }
    }
  }
}

export async function runHookDisable(projectRoot: string, id: string): Promise<void> {
  const config = loadConstraintsConfig(projectRoot);
  if (!config) {
    console.log('No .reins/constraints.yaml found.');
    return;
  }

  const constraint = config.constraints.find(c => c.id === id);
  if (!constraint) {
    console.log(`Constraint not found: ${id}`);
    return;
  }

  if (!constraint.enforcement.hook) {
    console.log(`Constraint ${id} does not have a hook.`);
    return;
  }

  constraint.enforcement.hook_mode = 'off';
  saveSnapshot(projectRoot, 'hook-disable');
  saveConstraintsConfig(projectRoot, config);

  console.log(`Hook disabled for constraint: ${id}`);
}

export async function runHookAdd(projectRoot: string, description: string): Promise<void> {
  // Generate a new constraint + hook from description
  // LLM call is a stub — we create a placeholder constraint and hook file
  const config = loadConstraintsConfig(projectRoot);
  if (!config) {
    console.log('No .reins/constraints.yaml found. Run `reins init` first.');
    return;
  }

  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);

  const id = `custom-${slug}`;

  // Check for duplicate
  if (config.constraints.find(c => c.id === id)) {
    console.log(`Constraint ${id} already exists.`);
    return;
  }

  const newConstraint = {
    id,
    rule: description,
    severity: 'important' as const,
    scope: 'global' as const,
    source: 'manual' as const,
    enforcement: {
      soft: false,
      hook: true,
      hook_type: 'pre_bash' as const,
      hook_mode: 'warn' as const,
      hook_check: `# Hook for: ${description}`,
    },
    status: 'draft' as const,
  };

  config.constraints.push(newConstraint);

  saveSnapshot(projectRoot, 'hook-add');
  saveConstraintsConfig(projectRoot, config);

  console.log(`Added constraint and hook placeholder: ${id}`);
  console.log(`Edit .reins/hooks/${id}.sh to implement the hook logic.`);
}

export async function runHook(action: string | undefined, args: string[]): Promise<void> {
  const projectRoot = process.cwd();

  switch (action) {
    case 'list':
      await runHookList(projectRoot);
      break;
    case 'disable': {
      const id = args[0];
      if (!id) {
        console.log('Usage: reins hook disable <id>');
        return;
      }
      await runHookDisable(projectRoot, id);
      break;
    }
    case 'add': {
      const description = args.join(' ');
      if (!description) {
        console.log('Usage: reins hook add <description>');
        return;
      }
      await runHookAdd(projectRoot, description);
      break;
    }
    default:
      console.log('Usage: reins hook <list|disable|add> [args...]');
      break;
  }
}
