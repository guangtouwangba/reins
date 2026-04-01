import { readFileSync, existsSync } from 'node:fs';
import { join, parse, dirname } from 'node:path';
import yaml from 'js-yaml';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { GateInput, GateResult } from './types.js';

/**
 * Parse the CLAUDE_TOOL_INPUT environment variable into a GateInput object.
 * Returns empty object if not set or invalid JSON.
 */
export function parseGateInput(): GateInput {
  const raw = process.env.CLAUDE_TOOL_INPUT;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as GateInput;
  } catch {
    return {};
  }
}

/**
 * Output a GateResult to stdout/stderr and exit with appropriate code.
 * exit 0 = allow (stdout text shown to Claude as context)
 * exit 2 = block (stderr text shown as block reason)
 */
export function outputResult(result: GateResult): never {
  if (result.messages.length > 0) {
    console.log(result.messages.join('\n'));
  }
  if (result.action === 'block' && result.blockReason) {
    console.error(result.blockReason);
  }
  process.exit(result.action === 'block' ? 2 : 0);
}

/**
 * Load constraints from .reins/constraints.yaml.
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadConstraints(projectRoot: string): Constraint[] {
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(constraintsPath)) return [];
  try {
    const raw = readFileSync(constraintsPath, 'utf-8');
    const config = yaml.load(raw) as ConstraintsConfig;
    return config?.constraints ?? [];
  } catch {
    return [];
  }
}

/**
 * Check if a file path is protected by Reins.
 * Protected paths should not be modified by the AI agent.
 */
export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const protectedPrefixes = ['.reins/'];
  const protectedExact = ['.claude/settings.json'];

  for (const prefix of protectedPrefixes) {
    if (normalized.startsWith(prefix)) return true;
  }
  for (const exact of protectedExact) {
    if (normalized === exact) return true;
  }
  return false;
}

/**
 * Resolve project root by walking up from cwd to find .reins/ directory.
 * Falls back to cwd if not found.
 */
export function resolveProjectRoot(): string {
  let dir = process.cwd();
  const { root } = parse(dir);
  while (dir !== root) {
    if (existsSync(join(dir, '.reins'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
