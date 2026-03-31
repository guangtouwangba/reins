import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { CodebaseContext } from '../scanner/types.js';

export interface Adapter {
  name: string;
  outputPath: string; // relative to projectRoot
  generate(constraints: Constraint[], context: CodebaseContext, config: ConstraintsConfig): string;
}

export interface AdapterResult {
  adapter: string;
  path: string;
  written: boolean;
  skipped: boolean;
  reason?: string;
}

export function runAdapters(
  projectRoot: string,
  constraints: Constraint[],
  context: CodebaseContext,
  config: ConstraintsConfig,
  adapters: Adapter[],
): AdapterResult[] {
  const results: AdapterResult[] = [];

  for (const adapter of adapters) {
    const outputPath = join(projectRoot, adapter.outputPath);
    let generated: string;

    try {
      generated = adapter.generate(constraints, context, config);
    } catch (err) {
      results.push({
        adapter: adapter.name,
        path: outputPath,
        written: false,
        skipped: true,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Create parent directories
    const parentDir = dirname(outputPath);
    mkdirSync(parentDir, { recursive: true });

    // Idempotency: skip write if content is identical
    if (existsSync(outputPath)) {
      const existing = readFileSync(outputPath, 'utf-8');
      if (existing === generated) {
        results.push({
          adapter: adapter.name,
          path: outputPath,
          written: false,
          skipped: true,
          reason: 'content unchanged',
        });
        continue;
      }
    }

    writeFileSync(outputPath, generated, 'utf-8');
    results.push({ adapter: adapter.name, path: outputPath, written: true, skipped: false });
  }

  return results;
}
