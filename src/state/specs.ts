import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface SpecBundle {
  specId: string;
  task: string;
  status: 'draft' | 'confirmed' | 'in-progress' | 'implemented' | 'abandoned';
  specContent: string | null;
  designContent: string | null;
  tasksContent: string | null;
  acceptanceCriteria: string[];
}

export interface SpecEntry {
  id: string;
  task: string;
  status: string;
  created: string;
  confirmed?: string;
  implemented?: string;
}

interface SpecIndex {
  specs: SpecEntry[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

function loadIndex(projectRoot: string): SpecIndex {
  const indexPath = join(projectRoot, '.reins', 'specs', 'index.yaml');
  if (!existsSync(indexPath)) return { specs: [] };
  try {
    const raw = readFileSync(indexPath, 'utf-8');
    return (yaml.load(raw) as SpecIndex) ?? { specs: [] };
  } catch {
    return { specs: [] };
  }
}

function saveIndex(projectRoot: string, index: SpecIndex): void {
  const specsDir = join(projectRoot, '.reins', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, 'index.yaml'), yaml.dump(index, { lineWidth: 120 }), 'utf-8');
}

export function createSpecDir(projectRoot: string, task: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(task);
  const specId = `${date}-${slug}`;
  const specDir = join(projectRoot, '.reins', 'specs', specId);
  mkdirSync(specDir, { recursive: true });

  const index = loadIndex(projectRoot);
  index.specs.push({
    id: specId,
    task,
    status: 'draft',
    created: new Date().toISOString(),
  });
  saveIndex(projectRoot, index);

  return specId;
}

export function writeSpecFile(projectRoot: string, specId: string, filename: string, content: string): void {
  const filePath = join(projectRoot, '.reins', 'specs', specId, filename);
  writeFileSync(filePath, content, 'utf-8');
}

export function loadSpec(projectRoot: string, specId: string): SpecBundle {
  const specDir = join(projectRoot, '.reins', 'specs', specId);
  if (!existsSync(specDir)) {
    throw new Error(`Spec not found: ${specId}`);
  }

  const index = loadIndex(projectRoot);
  const entry = index.specs.find(s => s.id === specId);

  const specPath = join(specDir, 'spec.md');
  const designPath = join(specDir, 'design.md');
  const tasksPath = join(specDir, 'tasks.md');

  const specContent = existsSync(specPath) ? readFileSync(specPath, 'utf-8') : null;
  const designContent = existsSync(designPath) ? readFileSync(designPath, 'utf-8') : null;
  const tasksContent = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf-8') : null;

  const acceptanceCriteria = specContent
    ? specContent.split('\n')
        .filter(line => line.trim().startsWith('- [ ]'))
        .map(line => line.trim().replace(/^- \[ \] /, ''))
    : [];

  return {
    specId,
    task: entry?.task ?? '',
    status: (entry?.status as SpecBundle['status']) ?? 'draft',
    specContent,
    designContent,
    tasksContent,
    acceptanceCriteria,
  };
}

export function listSpecs(projectRoot: string): SpecEntry[] {
  return loadIndex(projectRoot).specs;
}

export function updateSpecStatus(projectRoot: string, specId: string, status: SpecBundle['status']): void {
  const index = loadIndex(projectRoot);
  const entry = index.specs.find(s => s.id === specId);
  if (!entry) return;
  entry.status = status;
  if (status === 'confirmed') entry.confirmed = new Date().toISOString();
  if (status === 'implemented') entry.implemented = new Date().toISOString();
  saveIndex(projectRoot, index);
}
