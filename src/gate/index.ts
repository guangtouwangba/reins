import type { GateEvent } from './types.js';
import { parseGateInput, outputResult, resolveProjectRoot } from './shared.js';

export async function runGate(event: string): Promise<void> {
  try {
    const input = parseGateInput();
    const projectRoot = resolveProjectRoot();

    switch (event as GateEvent) {
      case 'context': {
        const { gateContext } = await import('./context.js');
        const result = await gateContext(projectRoot, input);
        outputResult(result);
        break;
      }
      case 'pre-edit': {
        const { gatePreEdit } = await import('./pre-edit.js');
        const result = await gatePreEdit(projectRoot, input);
        outputResult(result);
        break;
      }
      case 'post-edit': {
        const { gatePostEdit } = await import('./post-edit.js');
        const result = await gatePostEdit(projectRoot, input);
        outputResult(result);
        break;
      }
      case 'pre-bash': {
        const { gatePreBash } = await import('./pre-bash.js');
        const result = await gatePreBash(projectRoot, input);
        outputResult(result);
        break;
      }
      case 'stop': {
        const { gateStop } = await import('./stop.js');
        const result = await gateStop(projectRoot, input);
        outputResult(result);
        break;
      }
      default: {
        // Unknown event — allow silently, never block
        console.log(`reins gate: unknown event '${event}', allowing`);
        process.exit(0);
      }
    }
  } catch (err) {
    // Gate must NEVER crash Claude Code — always exit 0 on error
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`reins gate: internal error (${msg}), allowing`);
    process.exit(0);
  }
}
