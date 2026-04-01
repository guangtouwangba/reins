export type GateEvent = 'context' | 'pre-edit' | 'post-edit' | 'pre-bash' | 'stop';

export interface GateInput {
  // For Edit/Write (PreToolUse, PostToolUse)
  file_path?: string;
  path?: string;
  old_string?: string;
  new_string?: string;

  // For Bash (PreToolUse)
  command?: string;

  // For UserPromptSubmit
  prompt?: string;

  // For Stop
  result?: string;

  // Common
  tool_name?: string;
}

export interface GateResult {
  action: 'allow' | 'warn' | 'block';
  messages: string[];
  blockReason?: string;
}
