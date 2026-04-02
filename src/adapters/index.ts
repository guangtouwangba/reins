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

// V2 adapter types and registry
export type { AdapterDefinition, AdapterInput, AdapterOutput } from './base-adapter.js';
export { ADAPTER_REGISTRY, registerAdapter, runAdaptersV2 } from './base-adapter.js';
export { buildSharedContent } from './shared-content.js';

// V2 adapters — side-effect imports trigger registerAdapter()
import './claude-md.js';
import './cursor-rules.js';
import './copilot-instructions.js';
import './windsurf-rules.js';
import './cline.js';
import './continue-dev.js';
import './amazon-q.js';
import './augment.js';
import './aider.js';
import './gemini.js';
import './opencode.js';
import './antigravity.js';
