import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface ScanConfig {
  depth: string;
  exclude_dirs: string[];
}

export interface DevelopConfig {
  default_model: string;
  skip_stages: string[];
  constraint_profile: string;
}

export interface LearnConfig {
  auto_extract_threshold: number;
  suggestion_threshold: number;
  cooldown_messages: number;
  scope_default: string;
}

export interface UpdateConfig {
  auto_trigger: string;
  staleness_check: boolean;
  auto_apply: boolean;
}

export interface HooksConfig {
  default_mode: string;
  health_check: boolean;
  health_threshold: number;
}

export interface StatusConfig {
  default_format: string;
  history_days: number;
}

export interface EvaluationProfileConfig {
  exit_when: string;
  max_iterations: number;
}

export interface EvaluationConfig {
  profiles: Record<string, EvaluationProfileConfig>;
  auto_detect_type: boolean;
  l2_timeout: number;
  l3_timeout: number;
  l4_model: string;
}

export interface KnowledgeConfig {
  capture: {
    on_task_complete: boolean;
    on_correction: boolean;
    on_retry: boolean;
    reflection_model: string;
  };
  retrieval: {
    max_inject: number;
    max_inject_tokens: number;
    min_confidence: number;
    strategy: string;
  };
  decay: {
    stale_file_change_ratio: number;
    unused_decay_days: number;
    success_boost: number;
    failure_penalty: number;
  };
  capacity: {
    max_per_directory: number;
    max_global: number;
    min_confidence: number;
    eviction: string;
  };
  promotion: {
    min_confidence: number;
    min_validations: number;
    min_success_rate: number;
    auto_suggest: boolean;
  };
}

export interface AdaptersConfig {
  enabled: string[];
}

export interface ReinsConfig {
  scan: ScanConfig;
  develop: DevelopConfig;
  learn: LearnConfig;
  update: UpdateConfig;
  hooks: HooksConfig;
  status: StatusConfig;
  evaluation: EvaluationConfig;
  knowledge: KnowledgeConfig;
  adapters: AdaptersConfig;
}

export function getDefaultConfig(): ReinsConfig {
  return {
    scan: {
      depth: 'L0-L2',
      exclude_dirs: ['vendor/', 'generated/'],
    },
    develop: {
      default_model: 'sonnet',
      skip_stages: [],
      constraint_profile: 'default',
    },
    learn: {
      auto_extract_threshold: 85,
      suggestion_threshold: 60,
      cooldown_messages: 5,
      scope_default: 'project',
    },
    update: {
      auto_trigger: 'session_end',
      staleness_check: true,
      auto_apply: false,
    },
    hooks: {
      default_mode: 'block',
      health_check: true,
      health_threshold: 5,
    },
    status: {
      default_format: 'human',
      history_days: 30,
    },
    evaluation: {
      profiles: {
        relaxed: { exit_when: 'L0_passed', max_iterations: 20 },
        default: { exit_when: 'L0_passed AND L1_passed', max_iterations: 50 },
        strict: { exit_when: 'L0_passed AND L1_passed AND L2_passed AND L4_confidence >= 80', max_iterations: 100 },
        fullstack: { exit_when: 'L0_passed AND L1_passed AND L2_passed AND L3_passed AND L4_confidence >= 80', max_iterations: 100 },
      },
      auto_detect_type: true,
      l2_timeout: 300,
      l3_timeout: 600,
      l4_model: 'sonnet',
    },
    knowledge: {
      capture: {
        on_task_complete: true,
        on_correction: true,
        on_retry: true,
        reflection_model: 'haiku',
      },
      retrieval: {
        max_inject: 5,
        max_inject_tokens: 200,
        min_confidence: 40,
        strategy: 'file_affinity',
      },
      decay: {
        stale_file_change_ratio: 0.3,
        unused_decay_days: 60,
        success_boost: 3,
        failure_penalty: 15,
      },
      capacity: {
        max_per_directory: 10,
        max_global: 100,
        min_confidence: 20,
        eviction: 'lowest_confidence',
      },
      promotion: {
        min_confidence: 90,
        min_validations: 5,
        min_success_rate: 0.8,
        auto_suggest: true,
      },
    },
    adapters: {
      enabled: [],
    },
  };
}

function deepMerge(target: Record<string, unknown>, ...sources: Record<string, unknown>[]): Record<string, unknown> {
  const result = { ...target };
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      const targetVal = result[key];
      if (
        sourceVal !== undefined &&
        typeof sourceVal === 'object' &&
        sourceVal !== null &&
        !Array.isArray(sourceVal) &&
        typeof targetVal === 'object' &&
        targetVal !== null &&
        !Array.isArray(targetVal)
      ) {
        result[key] = deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
  }
  return result;
}

function loadYaml(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return (yaml.load(content) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export function loadConfig(projectRoot: string): ReinsConfig {
  const defaults = getDefaultConfig();
  const teamConfig = loadYaml(join(projectRoot, '.reins', 'config.yaml'));
  const localConfig = loadYaml(join(projectRoot, '.reins', 'config.local.yaml'));
  return deepMerge(
    defaults as unknown as Record<string, unknown>,
    (teamConfig ?? {}) as Record<string, unknown>,
    (localConfig ?? {}) as Record<string, unknown>,
  ) as unknown as ReinsConfig;
}
