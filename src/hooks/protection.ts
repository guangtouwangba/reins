import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROTECTION_SCRIPT = `#!/bin/bash
# reins: protect-constraints.sh
# Blocks edits to .reins/constraints.yaml, .reins/config.yaml, and .reins/hooks/
# This script is hardcoded and must never be derived from user-editable constraints.

command -v jq >/dev/null || { echo "reins hooks require jq" >&2; exit 0; }

FILE=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.path // .file_path // ""' 2>/dev/null)
[ -z "$FILE" ] && exit 0

if echo "$FILE" | grep -qE '(\\.reins/constraints\\.yaml|\\.reins/config\\.yaml|\\.reins/hooks/)'; then
  echo "reins: editing protected file is not allowed: $FILE" >&2
  echo "Protected paths: .reins/constraints.yaml, .reins/config.yaml, .reins/hooks/" >&2
  exit 2
fi

exit 0
`;

export function generateProtectionHook(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  const scriptPath = join(outputDir, 'protect-constraints.sh');
  writeFileSync(scriptPath, PROTECTION_SCRIPT, { encoding: 'utf-8', mode: 0o755 });
}
