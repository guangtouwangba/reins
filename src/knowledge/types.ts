export type KnowledgeType = 'coupling' | 'gotcha' | 'decision' | 'preference';
export type KnowledgeSource = 'reflection' | 'correction' | 'retry' | 'manual';

export interface InjectionOutcomes {
  success: number;
  failure: number;
}

export interface KnowledgeEntry {
  id: string;
  type: KnowledgeType;
  summary: string;
  detail: string;
  related_files: string[];
  tags: string[];
  confidence: number;
  source: KnowledgeSource;
  created: string;
  last_validated: string;
  last_injected: string;
  injection_outcomes: InjectionOutcomes;
  trigger_pattern?: string;
  file: string;
  scope?: string;
}

export interface KnowledgeIndex {
  version: number;
  entries: KnowledgeEntry[];
}
