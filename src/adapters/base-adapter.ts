import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { CodebaseContext } from '../scanner/types.js';
import { buildSharedContent } from './shared-content.js';
import type { SharedContent } from './shared-content.js';

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

// ---------------------------------------------------------------------------
// V2 Adapter system — interactive selection with detection
// ---------------------------------------------------------------------------

export interface AdapterDefinition {
  id: string;
  displayName: string;
  description: string;
  detect(projectRoot: string): boolean;
  generate(input: AdapterInput): AdapterOutput[];
}

export interface AdapterInput {
  projectRoot: string;
  constraints: Constraint[];
  context: CodebaseContext;
  config: ConstraintsConfig;
  content: SharedContent;
}

export interface AdapterOutput {
  path: string;
  content: string;
  label: string;
}

export const ADAPTER_REGISTRY: AdapterDefinition[] = [];

export function registerAdapter(adapter: AdapterDefinition): void {
  ADAPTER_REGISTRY.push(adapter);
}

export function runAdaptersV2(
  projectRoot: string,
  constraints: Constraint[],
  context: CodebaseContext,
  config: ConstraintsConfig,
  adapterIds: string[],
): AdapterResult[] {
  const content = buildSharedContent(constraints, context, config);
  const results: AdapterResult[] = [];

  for (const id of adapterIds) {
    const adapter = ADAPTER_REGISTRY.find(a => a.id === id);
    if (!adapter) continue;

    const input: AdapterInput = { projectRoot, constraints, context, config, content };

    try {
      const outputs = adapter.generate(input);
      for (const output of outputs) {
        const outputPath = join(projectRoot, output.path);
        const parentDir = dirname(outputPath);
        mkdirSync(parentDir, { recursive: true });

        // Idempotency: skip if content unchanged
        if (existsSync(outputPath)) {
          const existing = readFileSync(outputPath, 'utf-8');
          if (existing === output.content) {
            results.push({ adapter: adapter.id, path: outputPath, written: false, skipped: true, reason: 'content unchanged' });
            continue;
          }
        }

        writeFileSync(outputPath, output.content, 'utf-8');
        results.push({ adapter: adapter.id, path: outputPath, written: true, skipped: false });
      }
    } catch (err) {
      results.push({
        adapter: adapter.id,
        path: join(projectRoot, `<${adapter.id}>`),
        written: false,
        skipped: true,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
