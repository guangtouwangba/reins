import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface ScanConfig {
  depth: string;
  exclude_dirs: string[];
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

export interface SkillsConfig {
  enabled: boolean;
  sources: string[];
  inject: {
    max_tokens: number;
    max_skills: number;
  };
  auto_index: boolean;
}

export interface AdaptersConfig {
  enabled: string[];
}

/**
 * `reins ship` tunables. Defaults live in `getDefaultConfig()`; users may
 * override any subset in `.reins/config.yaml` under the `ship:` key.
 *
 * See `openspec/changes/2026-04-07-feature-ship/design.md` §10 for rationale.
 */
export interface ShipConfig {
  /** Per-feature retry budget when ship.feature.max_attempts is unset. */
  default_max_attempts: number;
  /** Timeout (ms) for each `claude -p` implement call. */
  implement_timeout_ms: number;
  /** Timeout (ms) for the full `pipeline.feature_verify` chain per attempt. */
  feature_verify_timeout_ms: number;
  /** `.reins/runs/` cleanup window in days. 0 disables cleanup. */
  log_retention_days: number;
  /**
   * When true, any out-of-scope touched file aborts the attempt. When false
   * (default), serial mode warns and parallel mode still blocks (drift in
   * parallel pollutes other worktrees' rebase).
   */
  abort_on_scope_drift: boolean;
  /** Hard ceiling on concurrent features in any parallel step. */
  max_parallelism: number;
  /** When false, ship skips the AI planner and falls back to depends_on order. */
  planner_enabled: boolean;
  /** When true, ship commits after each feature's feature_verify passes. */
  auto_commit: boolean;
  /**
   * Commit message style:
   * - `auto`: detect from `git log --oneline -20` (≥80% conventional → use it)
   * - `conventional`: `feat: <title>` + reins footer
   * - `free`: `<title>` + reins footer
   * - `custom`: use `commit_custom_template` with {title}/{id}/{run_id}/{attempts} placeholders
   */
  commit_style: 'auto' | 'conventional' | 'free' | 'custom';
  /** Template used when `commit_style === 'custom'`. */
  commit_custom_template?: string;
}

export interface ReinsConfig {
  scan: ScanConfig;
  learn: LearnConfig;
  update: UpdateConfig;
  hooks: HooksConfig;
  status: StatusConfig;
  knowledge: KnowledgeConfig;
  skills: SkillsConfig;
  adapters: AdaptersConfig;
  ship?: ShipConfig;
  gate?: {
    stop_skip_test?: boolean;
    stop_skip_lint?: boolean;
    context_max_knowledge?: number;
    context_max_skills?: number;
  };
}

export function getDefaultConfig(): ReinsConfig {
  return {
    scan: {
      depth: 'L0-L2',
      exclude_dirs: ['vendor/', 'generated/'],
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
    skills: {
      enabled: true,
      sources: [],
      inject: {
        max_tokens: 4000,
        max_skills: 5,
      },
      auto_index: true,
    },
    adapters: {
      enabled: [],
    },
    ship: {
      default_max_attempts: 3,
      implement_timeout_ms: 600_000,
      feature_verify_timeout_ms: 600_000,
      log_retention_days: 30,
      abort_on_scope_drift: false,
      max_parallelism: 3,
      planner_enabled: true,
      auto_commit: true,
      commit_style: 'auto',
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
