import type { HookType, HookMode } from '../constraints/schema.js';

export interface HookConfig {
  constraintId: string;
  hookType: HookType;
  scriptPath: string;
  mode: HookMode;
  description: string;
}
