import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverSkills, extractSkillMetadata, inferTriggers } from './skill-scanner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('discoverSkills', () => {
  it('finds skills in .claude/commands/', () => {
    const cmdDir = join(tmpDir, '.claude', 'commands');
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, 'testing.md'), '# Testing', 'utf-8');

    const sources = discoverSkills(tmpDir, []);
    const projectSources = sources.filter(s => s.path.startsWith(tmpDir));
    expect(projectSources.length).toBe(1);
    expect(projectSources[0]!.sourceType).toBe('project');
    expect(projectSources[0]!.priority).toBe(1);
  });

  it('finds skills in .reins/skills/', () => {
    const skillDir = join(tmpDir, '.reins', 'skills');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'deploy.md'), '# Deploy', 'utf-8');

    const sources = discoverSkills(tmpDir, []);
    const projectSources = sources.filter(s => s.path.startsWith(tmpDir));
    expect(projectSources.length).toBe(1);
    expect(projectSources[0]!.sourceType).toBe('team');
    expect(projectSources[0]!.priority).toBe(2);
  });

  it('finds skills in configured source directories', () => {
    const customDir = join(tmpDir, 'custom-skills');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'api.md'), '# API', 'utf-8');

    const sources = discoverSkills(tmpDir, [customDir]);
    expect(sources.some(s => s.sourceType === 'team' && s.priority === 3)).toBe(true);
  });

  it('handles missing directories gracefully', () => {
    const sources = discoverSkills(tmpDir, ['/nonexistent/path']);
    const projectSources = sources.filter(s => s.path.startsWith(tmpDir));
    expect(projectSources).toEqual([]);
  });

  it('ignores non-.md files', () => {
    const cmdDir = join(tmpDir, '.claude', 'commands');
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, 'testing.md'), '# Test', 'utf-8');
    writeFileSync(join(cmdDir, 'notes.txt'), 'notes', 'utf-8');

    const sources = discoverSkills(tmpDir, []);
    const projectSources = sources.filter(s => s.path.startsWith(tmpDir));
    expect(projectSources.length).toBe(1);
  });
});

describe('extractSkillMetadata', () => {
  it('parses YAML frontmatter triggers', () => {
    const dir = join(tmpDir, '.claude', 'commands');
    mkdirSync(dir, { recursive: true });
    const content = '---\ntriggers:\n  keywords: [test, e2e, playwright]\n  files: ["*.spec.ts"]\n---\n\n# E2E Testing\n\nContent here.';
    const path = join(dir, 'e2e-testing.md');
    writeFileSync(path, content, 'utf-8');

    const entry = extractSkillMetadata({ path, sourceType: 'project', priority: 1 });
    expect(entry.id).toBe('e2e-testing');
    expect(entry.title).toBe('E2E Testing');
    expect(entry.triggers.keywords).toContain('test');
    expect(entry.triggers.keywords).toContain('playwright');
    expect(entry.triggers.files).toContain('*.spec.ts');
    expect(entry.contentHash).toBeTruthy();
  });

  it('infers triggers from filename when no frontmatter', () => {
    const dir = join(tmpDir, '.claude', 'commands');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'api-design.md');
    writeFileSync(path, '# API Design\n\nUse express for routes.', 'utf-8');

    const entry = extractSkillMetadata({ path, sourceType: 'project', priority: 1 });
    expect(entry.triggers.keywords).toContain('api');
    expect(entry.triggers.keywords).toContain('design');
    expect(entry.triggers.keywords).toContain('express');
  });

  it('computes deterministic contentHash', () => {
    const dir = join(tmpDir, '.claude', 'commands');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'test.md');
    writeFileSync(path, '# Test\nContent.', 'utf-8');

    const e1 = extractSkillMetadata({ path, sourceType: 'project', priority: 1 });
    const e2 = extractSkillMetadata({ path, sourceType: 'project', priority: 1 });
    expect(e1.contentHash).toBe(e2.contentHash);
  });
});

describe('inferTriggers', () => {
  it('extracts keywords from filename', () => {
    const t = inferTriggers('e2e-testing', '');
    expect(t.keywords).toContain('e2e');
    expect(t.keywords).toContain('testing');
  });

  it('extracts tool names from content', () => {
    const t = inferTriggers('setup', 'We use Playwright for testing and Prisma for database.');
    expect(t.keywords).toContain('playwright');
    expect(t.keywords).toContain('prisma');
  });

  it('caps keywords at 10', () => {
    const content = 'playwright cypress jest vitest mocha eslint prettier prisma docker react vue angular nextjs remix astro express';
    const t = inferTriggers('everything', content);
    expect(t.keywords.length).toBeLessThanOrEqual(10);
  });

  it('extracts file patterns from backticks in content', () => {
    const t = inferTriggers('testing', 'Put tests in `*.spec.ts` files under `tests/**`');
    expect(t.files.length).toBeGreaterThan(0);
  });
});
