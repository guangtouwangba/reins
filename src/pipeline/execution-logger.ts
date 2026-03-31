import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ExecutionRecord } from './types.js';

function getDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getSequenceNumber(dir: string, dateStr: string): number {
  if (!existsSync(dir)) return 1;
  const files = readdirSync(dir).filter(f => f.startsWith(dateStr) && f.endsWith('.yaml'));
  return files.length + 1;
}

export function logExecution(projectRoot: string, record: ExecutionRecord): string {
  const logsDir = join(projectRoot, '.reins', 'logs', 'executions');
  mkdirSync(logsDir, { recursive: true });

  const dateStr = getDateString(new Date());
  const seq = getSequenceNumber(logsDir, dateStr);
  const seqStr = String(seq).padStart(3, '0');
  const filename = `${dateStr}-${seqStr}.yaml`;
  const filePath = join(logsDir, filename);

  const content = yaml.dump(record, { lineWidth: 120 });
  writeFileSync(filePath, content, 'utf-8');

  return filePath;
}
