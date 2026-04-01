import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TraceEntry {
  timestamp: string;
  module: string;
  event: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export class Tracer {
  private traceDir: string;
  private executionId: string;
  private enabled: boolean;

  constructor(projectRoot: string, opts?: { enabled?: boolean }) {
    this.executionId = randomUUID();
    this.traceDir = join(projectRoot, '.reins', 'logs', 'traces', this.executionId);
    this.enabled = opts?.enabled ?? true;
  }

  get id(): string {
    return this.executionId;
  }

  get directory(): string {
    return this.traceDir;
  }

  trace(module: string, event: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const entry: TraceEntry = {
      timestamp: new Date().toISOString(),
      module,
      event,
      data,
    };

    this.appendToFile(module, entry);
  }

  /** Trace an operation with automatic duration measurement */
  traceAsync<T>(module: string, event: string, fn: () => Promise<T>, data?: Record<string, unknown>): Promise<T> {
    if (!this.enabled) return fn();

    const start = Date.now();
    this.trace(module, `${event}:start`, data);

    return fn().then(
      (result) => {
        this.trace(module, `${event}:end`, { ...data, durationMs: Date.now() - start, success: true });
        return result;
      },
      (err) => {
        this.trace(module, `${event}:error`, {
          ...data,
          durationMs: Date.now() - start,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      },
    );
  }

  /** Synchronous operation tracing */
  traceSync<T>(module: string, event: string, fn: () => T, data?: Record<string, unknown>): T {
    if (!this.enabled) return fn();

    const start = Date.now();
    this.trace(module, `${event}:start`, data);

    try {
      const result = fn();
      this.trace(module, `${event}:end`, { ...data, durationMs: Date.now() - start, success: true });
      return result;
    } catch (err) {
      this.trace(module, `${event}:error`, {
        ...data,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private appendToFile(module: string, entry: TraceEntry): void {
    try {
      if (!existsSync(this.traceDir)) {
        mkdirSync(this.traceDir, { recursive: true });
      }
      const filePath = join(this.traceDir, `${module}.jsonl`);
      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Tracing must never break the pipeline
    }
  }
}

/** No-op tracer that does nothing -- used when tracing is disabled */
export const nullTracer = new Tracer('/dev/null', { enabled: false });
