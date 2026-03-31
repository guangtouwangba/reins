export type { Adapter, AdapterResult } from './base-adapter.js';
export { runAdapters } from './base-adapter.js';
export { ClaudeMdAdapter } from './claude-md.js';
export { AgentsMdAdapter } from './agents-md.js';
export { CursorRulesAdapter } from './cursor-rules.js';
export { CopilotInstructionsAdapter } from './copilot-instructions.js';
export { WindsurfRulesAdapter } from './windsurf-rules.js';

import { ClaudeMdAdapter } from './claude-md.js';
import { AgentsMdAdapter } from './agents-md.js';
import { CursorRulesAdapter } from './cursor-rules.js';
import { CopilotInstructionsAdapter } from './copilot-instructions.js';
import { WindsurfRulesAdapter } from './windsurf-rules.js';
import type { Adapter } from './base-adapter.js';

export const DEFAULT_ADAPTERS: Adapter[] = [
  ClaudeMdAdapter,
  AgentsMdAdapter,
  CursorRulesAdapter,
  CopilotInstructionsAdapter,
  WindsurfRulesAdapter,
];
