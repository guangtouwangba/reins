export interface SkillTrigger {
  keywords: string[];
  files: string[];
  commands: string[];
}

export interface SkillEntry {
  id: string;
  title: string;
  sourcePath: string;
  sourceType: 'project' | 'team' | 'user';
  priority: number;
  triggers: SkillTrigger;
  contentHash: string;
  tokenEstimate: number;
}

export interface SkillIndex {
  version: number;
  generatedAt: string;
  skills: SkillEntry[];
}

export interface ScoredSkill {
  entry: SkillEntry;
  score: number;
  content: string;
}

export interface SkillSource {
  path: string;
  sourceType: 'project' | 'team' | 'user';
  priority: number;
}
