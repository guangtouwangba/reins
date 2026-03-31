import { dirname } from 'node:path';
import { loadIndex } from './store.js';
import type { KnowledgeEntry } from './types.js';

export interface RetrievalQuery {
  prompt: string;
  recentFiles?: string[];
  planFiles?: string[];
  maxResults?: number;
  minConfidence?: number;
}

export interface RankedEntry {
  entry: KnowledgeEntry;
  score: number;
  matchReasons: string[];
}

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'have', 'from', 'they', 'will', 'been', 'when',
  'what', 'your', 'which', 'their', 'there', 'were', 'more', 'also', 'into',
  'some', 'than', 'then', 'them', 'these', 'make', 'like', 'time', 'just',
  'know', 'take', 'people', 'year', 'good', 'some', 'could', 'them', 'other',
  'than', 'then', 'look', 'only', 'come', 'over', 'think', 'also', 'back',
  'after', 'used', 'work', 'first', 'well', 'even', 'want', 'because', 'does',
  'file', 'code', 'function', 'should', 'need',
]);

function extractTags(prompt: string): string[] {
  const words = prompt.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
  return words.filter(w => !STOP_WORDS.has(w));
}

function extractFilesFromPrompt(prompt: string): string[] {
  const matches = prompt.match(/[a-z][a-z0-9]*(?:\/[a-z0-9._/-]+)+/g) ?? [];
  return matches;
}

function computeFileMatch(entry: KnowledgeEntry, queryFiles: string[]): { score: number; reasons: string[] } {
  if (queryFiles.length === 0) {
    // No query files — treat as global scope match
    if (entry.related_files.length === 0) return { score: 0.3, reasons: ['global-scope'] };
    return { score: 0, reasons: [] };
  }

  if (entry.related_files.length === 0) {
    // Entry is global scope
    return { score: 0.3, reasons: ['global-scope'] };
  }

  const reasons: string[] = [];
  let bestScore = 0;

  for (const relFile of entry.related_files) {
    for (const queryFile of queryFiles) {
      if (relFile === queryFile) {
        bestScore = 1.0;
        reasons.push(`file:${relFile}`);
        break;
      }
      if (dirname(relFile) === dirname(queryFile) && dirname(relFile) !== '.') {
        if (bestScore < 0.6) bestScore = 0.6;
        reasons.push(`dir:${dirname(relFile)}`);
      }
    }
  }

  return { score: bestScore, reasons };
}

function computeTagMatch(entry: KnowledgeEntry, promptTags: string[]): { score: number; reasons: string[] } {
  if (entry.tags.length === 0) return { score: 0, reasons: [] };
  if (promptTags.length === 0) return { score: 0, reasons: [] };

  const matched: string[] = [];
  for (const tag of entry.tags) {
    if (promptTags.includes(tag)) {
      matched.push(`tag:${tag}`);
    }
  }

  const score = Math.min(1.0, matched.length / entry.tags.length);
  return { score, reasons: matched };
}

function computeRecency(entry: KnowledgeEntry): number {
  const created = new Date(entry.created).getTime();
  const now = Date.now();
  const daysSince = (now - created) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - daysSince / 90);
}

function computeSuccessRate(entry: KnowledgeEntry): number {
  const { success, failure } = entry.injection_outcomes;
  const total = success + failure;
  if (total === 0) return 1.0;
  return success / total;
}

export function retrieveKnowledge(projectRoot: string, query: RetrievalQuery): RankedEntry[] {
  const index = loadIndex(projectRoot);
  const maxResults = query.maxResults ?? 5;
  const minConfidence = query.minConfidence ?? 40;

  const queryFiles = [
    ...(query.recentFiles ?? []),
    ...(query.planFiles ?? []),
    ...extractFilesFromPrompt(query.prompt),
  ];

  const promptTags = extractTags(query.prompt);

  const ranked: RankedEntry[] = [];

  for (const entry of index.entries) {
    // Filter below minConfidence
    if (entry.confidence < minConfidence) continue;

    const fileResult = computeFileMatch(entry, queryFiles);
    const tagResult = computeTagMatch(entry, promptTags);
    const confidenceNorm = entry.confidence / 100;
    const recency = computeRecency(entry);
    const successRate = computeSuccessRate(entry);

    const score =
      fileResult.score * 0.4 +
      tagResult.score * 0.2 +
      confidenceNorm * 0.2 +
      recency * 0.1 +
      successRate * 0.1;

    const matchReasons = [...fileResult.reasons, ...tagResult.reasons];

    ranked.push({ entry, score, matchReasons });
  }

  // Sort descending by score, return top maxResults
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, maxResults);
}
