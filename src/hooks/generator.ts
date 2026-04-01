import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HookConfig } from './types.js';
import { generateProtectionHook } from './protection.js';

const GATE_SCRIPT = (event: string) => `#!/bin/bash
# reins gate: ${event} hook
# Routes to Reins Node.js runtime for full constraint checking
exec reins gate ${event}
`;

interface GateHookDef {
  event: string;
  hookType: 'post_edit' | 'pre_bash' | 'pre_complete' | 'context_inject';
  filename: string;
}

const GATE_HOOKS: GateHookDef[] = [
  { event: 'context', hookType: 'context_inject', filename: 'gate-context.sh' },
  { event: 'pre-edit', hookType: 'post_edit', filename: 'gate-pre-edit.sh' },
  { event: 'post-edit', hookType: 'post_edit', filename: 'gate-post-edit.sh' },
  { event: 'pre-bash', hookType: 'pre_bash', filename: 'gate-pre-bash.sh' },
  { event: 'stop', hookType: 'pre_complete', filename: 'gate-stop.sh' },
];

export function generateHooks(projectRoot: string, _constraintsPath?: string): HookConfig[] {
  const outputDir = join(projectRoot, '.reins', 'hooks');
  mkdirSync(outputDir, { recursive: true });

  // Always generate the protection hook
  generateProtectionHook(outputDir);

  const hookConfigs: HookConfig[] = [];

  for (const def of GATE_HOOKS) {
    const script = GATE_SCRIPT(def.event);
    const scriptPath = join(outputDir, def.filename);
    writeFileSync(scriptPath, script, { encoding: 'utf-8', mode: 0o755 });

    hookConfigs.push({
      constraintId: `gate-${def.event}`,
      hookType: def.hookType,
      scriptPath,
      mode: 'block',
      description: `Reins gate: ${def.event}`,
    });
  }

  return hookConfigs;
}
