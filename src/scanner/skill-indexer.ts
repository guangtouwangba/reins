import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillEntry, SkillIndex } from './skill-types.js';
import { discoverSkills, extractSkillMetadata } from './skill-scanner.js';

export function buildSkillIndex(projectRoot: string, sources: string[]): SkillIndex {
  const skillSources = discoverSkills(projectRoot, sources);
  const seen = new Map<string, SkillEntry>();

  for (const source of skillSources) {
    try {
      const entry = extractSkillMetadata(source);
      // Dedup by id: highest priority (lowest number) wins
      const existing = seen.get(entry.id);
      if (!existing || entry.priority < existing.priority) {
        seen.set(entry.id, entry);
      }
    } catch {
      // Skip unreadable skill files
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    skills: Array.from(seen.values()),
  };
}

export function saveSkillIndex(projectRoot: string, index: SkillIndex): void {
  const reinsDir = join(projectRoot, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  writeFileSync(join(reinsDir, 'skill-index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

export function loadSkillIndex(projectRoot: string): SkillIndex | null {
  const indexPath = join(projectRoot, '.reins', 'skill-index.json');
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as SkillIndex;
  } catch {
    return null;
  }
}
