import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { CodebaseContext } from '../scanner/types.js';
import type {
  Constraint,
  ConstraintsConfig,
  ConstraintScope,
  ConstraintSource,
  ConstraintEnforcement,
  Severity,
} from './schema.js';
import { classifyConstraint } from './classifier.js';

// ---------------------------------------------------------------------------
// Types for raw YAML template entries
// ---------------------------------------------------------------------------

interface TemplateEntry {
  id: string;
  rule: string;
  severity?: Severity;
  scope?: string;
  condition?: string;
  enforcement?: Partial<ConstraintEnforcement>;
}

interface TemplateFile {
  constraints: TemplateEntry[];
}

// ---------------------------------------------------------------------------
// Condition evaluation — simple dot-path resolver, no eval
// ---------------------------------------------------------------------------

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Evaluate a simple condition string like "existingRules.typeCheck !== true".
 * Supports: `!==`, `===`, `=== true`, `!== true`, `=== false`, `!== false`.
 * Returns true (include constraint) when condition passes or is absent.
 */
function evaluateCondition(condition: string, context: CodebaseContext): boolean {
  const neqMatch = condition.match(/^(.+?)\s*!==\s*(.+)$/);
  const eqMatch = condition.match(/^(.+?)\s*===\s*(.+)$/);

  const match = neqMatch ?? eqMatch;
  if (!match) return true; // unknown condition syntax → include

  const pathStr = match[1];
  const rawValue = match[2];
  if (pathStr === undefined || rawValue === undefined) return true;

  const actualValue = resolvePath(context, pathStr.trim());

  let expected: unknown;
  const rv = rawValue.trim();
  if (rv === 'true') expected = true;
  else if (rv === 'false') expected = false;
  else if (rv === 'null') expected = null;
  else if (rv === 'undefined') expected = undefined;
  else if (!isNaN(Number(rv))) expected = Number(rv);
  else expected = rv.replace(/^['"]|['"]$/g, '');

  if (neqMatch) return actualValue !== expected;
  return actualValue === expected;
}

// ---------------------------------------------------------------------------
// Template loader
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

const SUPPORTED_LANGUAGES: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'typescript', // use TS template for JS projects too
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
};

export function loadTemplates(languages: string[], context: CodebaseContext): Constraint[] {
  const seen = new Set<string>();
  const result: Constraint[] = [];

  for (const lang of languages) {
    const templateName = SUPPORTED_LANGUAGES[lang.toLowerCase()];
    if (!templateName) continue;
    if (seen.has(templateName)) continue;
    seen.add(templateName);

    const templatePath = join(TEMPLATES_DIR, `${templateName}.yaml`);
    if (!existsSync(templatePath)) continue;

    let parsed: TemplateFile;
    try {
      const raw = readFileSync(templatePath, 'utf-8');
      parsed = yaml.load(raw) as TemplateFile;
    } catch {
      continue; // skip unparseable templates
    }

    if (!Array.isArray(parsed?.constraints)) continue;

    for (const entry of parsed.constraints) {
      if (!entry.id || !entry.rule) continue;

      // Evaluate optional condition
      if (entry.condition && !evaluateCondition(entry.condition, context)) {
        continue;
      }

      const enforcement: ConstraintEnforcement = {
        soft: entry.enforcement?.soft ?? true,
        hook: entry.enforcement?.hook ?? false,
        ...(entry.enforcement?.hook_type ? { hook_type: entry.enforcement.hook_type } : {}),
        ...(entry.enforcement?.hook_mode ? { hook_mode: entry.enforcement.hook_mode } : {}),
        ...(entry.enforcement?.hook_check ? { hook_check: entry.enforcement.hook_check } : {}),
      };

      const partialConstraint = {
        id: entry.id,
        rule: entry.rule,
        scope: (entry.scope ?? 'global') as ConstraintScope,
        source: 'auto' as ConstraintSource,
        enforcement,
        status: 'active' as const,
      };

      const severity: Severity = entry.severity ?? classifyConstraint(partialConstraint);

      result.push({ ...partialConstraint, severity });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Inference rules
// ---------------------------------------------------------------------------

export function inferConstraints(context: CodebaseContext): Constraint[] {
  const constraints: Constraint[] = [];

  // Repository layer → no direct DB access outside repository
  if (context.architecture.layers.includes('repository')) {
    constraints.push({
      id: 'infer-repository-layer',
      rule: 'Database access must only occur inside the repository layer; never query the database directly from service or controller code',
      severity: 'critical',
      scope: 'global',
      source: 'auto',
      enforcement: { soft: false, hook: false },
      status: 'active',
    });
  }

  // Prisma detected → no direct SQL
  const deps = context.existingRules.linter
    ? JSON.stringify(context.existingRules.linter)
    : '';
  const hasPrisma =
    context.structure.files.some(f => f.path.includes('prisma')) || deps.includes('prisma');
  if (hasPrisma) {
    constraints.push({
      id: 'infer-no-direct-sql',
      rule: 'Use Prisma client for all database queries; never write raw SQL strings',
      severity: 'critical',
      scope: 'global',
      source: 'auto',
      enforcement: { soft: false, hook: false },
      status: 'active',
    });
  }

  // Linter no-console rule
  const linter = context.existingRules.linter as Record<string, unknown> | null;
  const linterRules = linter?.['rules'] as Record<string, unknown> | undefined;
  if (linterRules?.['no-console'] !== undefined) {
    constraints.push({
      id: 'infer-no-console-log',
      rule: 'Do not leave console.log statements in production code',
      severity: 'important',
      scope: 'global',
      source: 'auto',
      enforcement: { soft: true, hook: false },
      status: 'active',
    });
  }

  // Test pattern
  if (context.testing.pattern) {
    constraints.push({
      id: 'infer-test-location',
      rule: `Place test files following the project pattern: ${context.testing.pattern}`,
      severity: 'helpful',
      scope: 'global',
      source: 'auto',
      enforcement: { soft: true, hook: false },
      status: 'active',
    });
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function generateConstraints(
  context: CodebaseContext,
  projectRoot: string,
): Constraint[] {
  const templateConstraints = loadTemplates(context.stack.language, context);
  const inferred = inferConstraints(context);

  // Deduplicate: template wins on id collision
  const merged = new Map<string, Constraint>();
  for (const c of templateConstraints) {
    merged.set(c.id, c);
  }
  for (const c of inferred) {
    if (!merged.has(c.id)) {
      merged.set(c.id, c);
    }
  }

  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

export function writeConstraintsFile(
  projectRoot: string,
  constraints: Constraint[],
  context: CodebaseContext,
): void {
  const reinsDir = join(projectRoot, '.reins');
  mkdirSync(reinsDir, { recursive: true });

  const packageManager = context.stack.packageManager || 'npm';
  const pmRun = packageManager === 'npm' ? 'npm run' : packageManager === 'yarn' ? 'yarn' : `${packageManager} run`;

  const config: ConstraintsConfig = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: {
      name: projectRoot.split('/').pop() ?? 'project',
      type: context.architecture.pattern,
    },
    stack: {
      primary_language: context.stack.language[0] ?? 'unknown',
      framework: context.stack.framework[0] ?? 'none',
      test_framework: context.stack.testFramework,
      package_manager: packageManager,
    },
    constraints,
    pipeline: {
      planning: 'ultrathink',
      execution: 'default',
      verification: { engine: 'reins', max_iterations: 3 },
      qa: true,
      pre_commit: [`${pmRun} lint`, `${pmRun} typecheck`],
      post_develop: [`${pmRun} test`],
    },
    profiles: {
      strict: {
        constraints: ['critical', 'important', 'helpful'],
        hooks: ['critical', 'important'],
        pipeline: ['planning', 'execution', 'verification', 'qa'],
        output_format: 'detailed',
      },
      default: {
        constraints: ['critical', 'important'],
        hooks: ['critical'],
        pipeline: ['execution', 'verification'],
      },
      relaxed: {
        constraints: ['critical'],
        hooks: [],
        pipeline: ['execution'],
      },
      ci: {
        constraints: ['critical', 'important', 'helpful'],
        hooks: ['critical', 'important'],
        pipeline: ['execution', 'verification', 'qa'],
        output_format: 'json',
      },
    },
  };

  const yamlContent = yaml.dump(config, { lineWidth: 120, quotingType: '"' });
  writeFileSync(join(reinsDir, 'constraints.yaml'), yamlContent, 'utf-8');
}
