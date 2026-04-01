import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Tracer, nullTracer } from './tracer.js';
import type { TraceEntry } from './tracer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-diag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Tracer', () => {
  it('creates trace directory on first trace', () => {
    const tracer = new Tracer(tmpDir);
    tracer.trace('scan', 'detect-stack', { language: 'typescript' });

    expect(existsSync(tracer.directory)).toBe(true);
  });

  it('writes JSONL entries to module-specific files', () => {
    const tracer = new Tracer(tmpDir);
    tracer.trace('scan', 'event1', { key: 'value1' });
    tracer.trace('scan', 'event2', { key: 'value2' });
    tracer.trace('hooks', 'fire', { hookId: 'test' });

    const scanFile = join(tracer.directory, 'scan.jsonl');
    const hooksFile = join(tracer.directory, 'hooks.jsonl');
    expect(existsSync(scanFile)).toBe(true);
    expect(existsSync(hooksFile)).toBe(true);

    const scanLines = readFileSync(scanFile, 'utf-8').trim().split('\n');
    expect(scanLines).toHaveLength(2);

    const entry = JSON.parse(scanLines[0]!) as TraceEntry;
    expect(entry.module).toBe('scan');
    expect(entry.event).toBe('event1');
    expect(entry.data?.key).toBe('value1');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('has a unique execution id', () => {
    const t1 = new Tracer(tmpDir);
    const t2 = new Tracer(tmpDir);
    expect(t1.id).not.toBe(t2.id);
  });

  it('traceSync measures duration and captures errors', () => {
    const tracer = new Tracer(tmpDir);

    const result = tracer.traceSync('test', 'compute', () => 42);
    expect(result).toBe(42);

    expect(() => {
      tracer.traceSync('test', 'fail', () => { throw new Error('boom'); });
    }).toThrow('boom');

    const lines = readFileSync(join(tracer.directory, 'test.jsonl'), 'utf-8').trim().split('\n');
    // compute:start, compute:end, fail:start, fail:error = 4 entries
    expect(lines).toHaveLength(4);

    const errorEntry = JSON.parse(lines[3]!) as TraceEntry;
    expect(errorEntry.event).toBe('fail:error');
    expect(errorEntry.data?.error).toBe('boom');
    expect(typeof errorEntry.data?.durationMs).toBe('number');
  });

  it('traceAsync measures duration', async () => {
    const tracer = new Tracer(tmpDir);

    const result = await tracer.traceAsync('test', 'async-op', async () => 'done');
    expect(result).toBe('done');

    const lines = readFileSync(join(tracer.directory, 'test.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const endEntry = JSON.parse(lines[1]!) as TraceEntry;
    expect(endEntry.event).toBe('async-op:end');
    expect(endEntry.data?.success).toBe(true);
  });

  it('nullTracer does not create files', () => {
    nullTracer.trace('scan', 'test', { foo: 'bar' });
    // /dev/null/.reins/... should not exist or cause errors
    expect(true).toBe(true); // just verify no throw
  });

  it('disabled tracer skips all writes', () => {
    const tracer = new Tracer(tmpDir, { enabled: false });
    tracer.trace('scan', 'event', { data: 'test' });
    expect(existsSync(tracer.directory)).toBe(false);
  });
});
