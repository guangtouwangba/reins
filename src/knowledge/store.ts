import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import type { KnowledgeEntry, KnowledgeIndex } from './types.js';

const KNOWLEDGE_DIR = '.reins/knowledge';
const INDEX_FILE = 'index.yaml';

function getKnowledgeDir(projectRoot: string): string {
  return join(projectRoot, KNOWLEDGE_DIR);
}

export function loadIndex(projectRoot: string): KnowledgeIndex {
  const indexPath = join(getKnowledgeDir(projectRoot), INDEX_FILE);
  if (!existsSync(indexPath)) {
    return { version: 1, entries: [] };
  }
  try {
    const raw = readFileSync(indexPath, 'utf-8');
    const parsed = yaml.load(raw) as KnowledgeIndex;
    return parsed ?? { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveIndex(projectRoot: string, index: KnowledgeIndex): void {
  const knowledgeDir = getKnowledgeDir(projectRoot);
  mkdirSync(knowledgeDir, { recursive: true });
  const content = yaml.dump(index, { lineWidth: 120, quotingType: '"' });
  writeFileSync(join(knowledgeDir, INDEX_FILE), content, 'utf-8');
}

export function generateId(projectRoot: string): string {
  const index = loadIndex(projectRoot);
  if (index.entries.length === 0) return 'k-001';

  let maxNum = 0;
  for (const entry of index.entries) {
    const match = entry.id.match(/^k-(\d+)$/);
    if (match?.[1]) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `k-${String(maxNum + 1).padStart(3, '0')}`;
}

export function generateFilename(type: string, summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${type}-${slug}.md`;
}

function buildMarkdown(entry: KnowledgeEntry): string {
  const frontmatter: Record<string, unknown> = {
    id: entry.id,
    type: entry.type,
    confidence: entry.confidence,
    created: entry.created,
    source: entry.source,
  };
  if (entry.trigger_pattern) {
    frontmatter['trigger_pattern'] = entry.trigger_pattern;
  }

  const header = yaml.dump(frontmatter, { lineWidth: 120 }).trim();
  return `---\n${header}\n---\n# ${entry.summary}\n${entry.detail}\n`;
}

export function saveEntry(projectRoot: string, entry: KnowledgeEntry): void {
  const knowledgeDir = getKnowledgeDir(projectRoot);
  mkdirSync(knowledgeDir, { recursive: true });

  // Write the markdown file
  const markdownPath = join(knowledgeDir, entry.file);
  writeFileSync(markdownPath, buildMarkdown(entry), 'utf-8');

  // Update index
  const index = loadIndex(projectRoot);
  const existingIdx = index.entries.findIndex(e => e.id === entry.id);
  if (existingIdx >= 0) {
    index.entries[existingIdx] = entry;
  } else {
    index.entries.push(entry);
  }
  saveIndex(projectRoot, index);
}

export function loadEntry(projectRoot: string, id: string): KnowledgeEntry | null {
  const index = loadIndex(projectRoot);
  const meta = index.entries.find(e => e.id === id);
  if (!meta) return null;

  // Return from index (markdown file has the content, index has all metadata)
  return meta;
}
