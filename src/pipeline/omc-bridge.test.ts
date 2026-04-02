import { describe, it, expect, afterEach } from 'vitest';
import { StubOMCBridge, CliOMCBridge, getOMCBridge, setOMCBridge } from './omc-bridge.js';

describe('StubOMCBridge', () => {
  it('ralplan returns empty plan', async () => {
    const bridge = new StubOMCBridge();
    const plan = await bridge.ralplan('test task');
    expect(plan.steps).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.verificationCases).toEqual([]);
  });

  it('executor returns success stub', async () => {
    const bridge = new StubOMCBridge();
    const result = await bridge.executor('test', {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('stub');
  });

  it('ralph returns success with no issues', async () => {
    const bridge = new StubOMCBridge();
    const result = await bridge.ralph('test', 3);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe('CliOMCBridge', () => {
  it('ralplan handles CLI error gracefully', async () => {
    const bridge = new CliOMCBridge('nonexistent-command-xyz');
    const plan = await bridge.ralplan('test');
    expect(plan.steps).toEqual([]);
  });

  it('executor handles CLI error gracefully', async () => {
    const bridge = new CliOMCBridge('nonexistent-command-xyz');
    const result = await bridge.executor('test', {});
    expect(result.success).toBe(false);
  });

  it('ralph handles CLI error gracefully', async () => {
    const bridge = new CliOMCBridge('nonexistent-command-xyz');
    const result = await bridge.ralph('test', 1);
    expect(result.success).toBe(false);
  });
});

describe('getOMCBridge', () => {
  afterEach(() => setOMCBridge(null));

  it('returns override when set', () => {
    const custom = new StubOMCBridge();
    setOMCBridge(custom);
    expect(getOMCBridge()).toBe(custom);
  });

  it('returns a bridge instance (stub or cli)', () => {
    const bridge = getOMCBridge();
    expect(bridge).toBeDefined();
    expect(typeof bridge.ralplan).toBe('function');
    expect(typeof bridge.executor).toBe('function');
    expect(typeof bridge.ralph).toBe('function');
  });
});
