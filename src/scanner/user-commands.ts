import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandMap, ResolvedCommand } from './types.js';

interface UserCommandsFile {
  commands?: Partial<Record<keyof CommandMap, string>>;
  packages?: Record<string, Partial<Record<keyof CommandMap, string>>>;
}

const USER_COMMANDS_FILE = '.reins/commands.json';

/**
 * Load user-declared command overrides from .reins/commands.json.
 * User commands have the highest priority in the merge chain.
 */
export function loadUserCommands(projectRoot: string): Partial<Record<keyof CommandMap, ResolvedCommand>> {
  const result: Partial<Record<keyof CommandMap, ResolvedCommand>> = {};
  const filePath = join(projectRoot, USER_COMMANDS_FILE);

  if (!existsSync(filePath)) return result;

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as UserCommandsFile;
    if (!raw.commands) return result;

    for (const [key, command] of Object.entries(raw.commands)) {
      if (command) {
        result[key as keyof CommandMap] = {
          command,
          source: 'user',
          confidence: 1.0,
        };
      }
    }
  } catch {
    // skip unparseable user commands
  }

  return result;
}

/**
 * Load user-declared per-package command overrides.
 */
export function loadUserPackageOverrides(projectRoot: string): Record<string, Partial<Record<keyof CommandMap, ResolvedCommand>>> {
  const result: Record<string, Partial<Record<keyof CommandMap, ResolvedCommand>>> = {};
  const filePath = join(projectRoot, USER_COMMANDS_FILE);

  if (!existsSync(filePath)) return result;

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as UserCommandsFile;
    if (!raw.packages) return result;

    for (const [pkgName, commands] of Object.entries(raw.packages)) {
      result[pkgName] = {};
      for (const [key, command] of Object.entries(commands)) {
        if (command) {
          result[pkgName]![key as keyof CommandMap] = {
            command,
            source: 'user',
            confidence: 1.0,
          };
        }
      }
    }
  } catch {
    // skip unparseable user commands
  }

  return result;
}

/**
 * Write user command overrides to .reins/commands.json.
 */
export function writeUserCommands(
  projectRoot: string,
  commands: Partial<Record<keyof CommandMap, string>>,
): void {
  const filePath = join(projectRoot, USER_COMMANDS_FILE);
  const reinsDir = join(projectRoot, '.reins');

  if (!existsSync(reinsDir)) {
    mkdirSync(reinsDir, { recursive: true });
  }

  let existing: UserCommandsFile = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8')) as UserCommandsFile;
    } catch {
      // start fresh
    }
  }

  existing.commands = { ...existing.commands, ...commands };
  writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
}
