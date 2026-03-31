import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

export interface DirectoryProfile {
  path: string;
  purpose: string;
  constraints: Constraint[];
  keyFiles: string[];
  patternRef: string;
}

// ---------------------------------------------------------------------------
// Known layer purposes
// ---------------------------------------------------------------------------

const LAYER_PURPOSES: Record<string, string> = {
  app: 'Application entry points and top-level configuration',
  lib: 'Shared library code and utilities',
  src: 'Main source code',
  components: 'UI components and presentational logic',
  services: 'Business logic and service layer',
  service: 'Business logic and service layer',
  api: 'API route handlers and controllers',
  repositories: 'Data access layer — database queries and persistence',
  repository: 'Data access layer — database queries and persistence',
  controllers: 'Request handlers and route controllers',
  controller: 'Request handlers and route controllers',
  models: 'Domain models and data structures',
  model: 'Domain models and data structures',
  hooks: 'React hooks and shared stateful logic',
  utils: 'Utility functions and helpers',
  util: 'Utility functions and helpers',
  middleware: 'Middleware functions and cross-cutting concerns',
  types: 'TypeScript type definitions',
  config: 'Configuration files and constants',
  tests: 'Test suites and test utilities',
  __tests__: 'Test suites (Jest convention)',
};

// Layer → best-matching L2 topic
const LAYER_PATTERN_REFS: Record<string, string> = {
  api: 'api-patterns',
  services: 'api-patterns',
  service: 'api-patterns',
  controllers: 'api-patterns',
  controller: 'api-patterns',
  repositories: 'general-patterns',
  repository: 'general-patterns',
  tests: 'testing-patterns',
  __tests__: 'testing-patterns',
  hooks: 'general-patterns',
  utils: 'module-patterns',
  util: 'module-patterns',
  lib: 'module-patterns',
  models: 'general-patterns',
  model: 'general-patterns',
};

const KNOWN_LAYERS = new Set(Object.keys(LAYER_PURPOSES));

// ---------------------------------------------------------------------------
// Extract directory name from a path (last segment)
// ---------------------------------------------------------------------------

function dirName(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

// ---------------------------------------------------------------------------
// Build directory profiles
// ---------------------------------------------------------------------------

export function buildDirectoryProfiles(
  context: CodebaseContext,
  constraints: Constraint[],
): DirectoryProfile[] {
  const profilePaths = new Set<string>();

  // Architecture layers detected in context
  for (const layer of context.architecture.layers) {
    profilePaths.add(layer);
  }

  // Directories in structure that match known layer names (top-level or src/*)
  for (const dir of context.structure.directories) {
    const name = dirName(dir.path);
    if (KNOWN_LAYERS.has(name)) {
      profilePaths.add(dir.path);
    }
  }

  // Directories referenced in constraint scopes
  for (const constraint of constraints) {
    if (constraint.scope.startsWith('directory:')) {
      const dirPath = constraint.scope.slice('directory:'.length);
      profilePaths.add(dirPath);
    }
  }

  return Array.from(profilePaths).map(path => {
    const name = dirName(path);
    const purpose = LAYER_PURPOSES[name] ?? `${name} module`;
    const patternRef = LAYER_PATTERN_REFS[name] ?? 'general-patterns';

    // Key files: files inside this directory (first 5)
    const keyFiles = context.structure.files
      .filter(f => f.path.startsWith(path + '/') || f.path === path)
      .slice(0, 5)
      .map(f => f.path);

    // Constraints relevant to this directory
    const dirConstraints = constraints.filter(
      c =>
        c.severity === 'important' &&
        (c.scope === 'global' || c.scope === `directory:${path}`),
    );

    return { path, purpose, constraints: dirConstraints, keyFiles, patternRef };
  });
}

// ---------------------------------------------------------------------------
// Render a single AGENTS.md
// ---------------------------------------------------------------------------

function renderAgentsMd(profile: DirectoryProfile, allImportant: Constraint[]): string {
  const relevant = allImportant
    .filter(
      c => c.scope === 'global' || c.scope === `directory:${profile.path}`,
    )
    .slice(0, 5);

  const lines: string[] = [];
  lines.push(`# ${profile.path} — ${profile.purpose}`);
  lines.push('');
  lines.push('## Purpose');
  lines.push('');
  lines.push(profile.purpose + '.');
  lines.push('');
  lines.push('## Rules for This Directory');
  lines.push('');

  if (relevant.length === 0) {
    lines.push('- No specific rules defined for this directory.');
  } else {
    lines.push(...relevant.map(c => `- ${c.rule}`));
  }

  const keyFilesSection = profile.keyFiles.length > 0
    ? ['', '## Key Files', '', ...profile.keyFiles.map(f => `- \`${f}\``)]
    : [];

  const patternsSection = [
    '',
    '## Patterns',
    '',
    `See \`.reins/patterns/${profile.patternRef}.md\` for detailed patterns.`,
  ];

  // Check 30-line hard cap
  let allLines = [...lines, ...keyFilesSection, ...patternsSection];

  if (allLines.length > 30) {
    // Drop key files first
    allLines = [...lines, ...patternsSection];
  }

  if (allLines.length > 30) {
    // Truncate rules to 3
    const rulesStart = lines.findIndex(l => l === '## Rules for This Directory') + 2;
    const truncated = lines.slice(0, rulesStart);
    const truncRules = relevant.slice(0, 3);
    truncated.push(...(truncRules.length > 0 ? truncRules.map(c => `- ${c.rule}`) : ['- No specific rules defined.']));
    allLines = [...truncated, ...patternsSection];
  }

  return allLines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function generateL1(
  projectRoot: string,
  constraints: Constraint[],
  directories: DirectoryProfile[],
): void {
  const importantConstraints = constraints.filter(c => c.severity === 'important');

  for (const profile of directories) {
    const dirPath = join(projectRoot, profile.path);

    // Skip if directory doesn't exist on disk
    if (!existsSync(dirPath)) continue;

    mkdirSync(dirPath, { recursive: true });
    const content = renderAgentsMd(profile, importantConstraints);
    writeFileSync(join(dirPath, 'AGENTS.md'), content, 'utf-8');
  }
}
