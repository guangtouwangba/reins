import type { Constraint, Severity, ProfileConfig, ConstraintsConfig } from './schema.js';

const BUILT_IN_PROFILES: Record<string, ProfileConfig> = {
  strict: {
    constraints: 'all',
    hooks: 'all',
    pipeline: ['planning', 'execution', 'review', 'qa'],
  },
  default: {
    constraints: ['critical', 'important'],
    hooks: ['critical', 'important'],
    pipeline: ['planning', 'execution', 'review', 'qa'],
  },
  relaxed: {
    constraints: ['critical'],
    hooks: ['critical'],
    pipeline: ['execution'],
  },
  ci: {
    constraints: 'all',
    hooks: 'all',
    pipeline: ['execution', 'qa'],
    output_format: 'json',
  },
};

export function getProfile(name: string, config: ConstraintsConfig): ProfileConfig {
  // User-defined profiles in config take precedence
  if (config.profiles && config.profiles[name]) {
    return config.profiles[name];
  }
  // Fall back to built-ins
  if (BUILT_IN_PROFILES[name]) {
    return BUILT_IN_PROFILES[name];
  }
  // Fall back to 'default'
  return BUILT_IN_PROFILES['default']!;
}

export function filterConstraintsByProfile(
  constraints: Constraint[],
  profileName: string,
  config: ConstraintsConfig,
): Constraint[] {
  const profile = getProfile(profileName, config);

  if (profile.constraints === 'all') {
    return constraints;
  }

  const allowed = profile.constraints as Severity[];
  return constraints.filter(c => allowed.includes(c.severity));
}
