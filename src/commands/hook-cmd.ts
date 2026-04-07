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

  if (!config) {
    console.log('No constraints configured yet.');
    console.log('');
    console.log('Run: reins init');
    return;
  }

  if (hookFiles.length === 0 && config.constraints.every(c => !c.enforcement.hook)) {
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
    case 'add':
      // Adding a constraint requires LLM judgment (rule validation, scope
      // inference, severity calibration, grounding evidence). The CLI no
      // longer ships an LLM — that work belongs in the user's IDE, where
      // there is full project context. Point them at the slash command.
      console.log('`reins hook add` has been replaced by the /reins-add-constraint slash');
      console.log('command. Open Claude Code or Cursor in this repo and run:');
      console.log('');
      console.log('  /reins-add-constraint');
      console.log('');
      console.log('The slash command validates the rule against project context, picks a');
      console.log('scope and severity, and writes constraints.yaml safely.');
      break;
    default:
      if (action) {
        console.log(`Unknown action: ${action}`);
        console.log('');
      }
      console.log('Usage: reins hook <list|disable> [args...]');
      console.log('       (To add a constraint, use /reins-add-constraint in your IDE.)');
      break;
  }
}
