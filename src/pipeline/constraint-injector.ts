import type { Constraint, Severity } from '../constraints/schema.js';
import type { InjectionContext, Profile } from './types.js';
import type { ScoredSkill } from '../scanner/skill-types.js';

// ---------------------------------------------------------------------------
// Profile filtering
// ---------------------------------------------------------------------------

export function filterByProfile(constraints: Constraint[], profile: Profile): Constraint[] {
  if (profile === 'all' || profile === 'strict') {
    return constraints;
  }

  if (profile === 'relaxed') {
    return constraints.filter(c => c.severity === 'critical');
  }

  if (profile === 'default') {
    return constraints.filter(c => c.severity === 'critical' || c.severity === 'important');
  }

  // Custom profile: treat as array of severities (comma-separated or known keywords)
  // Fall back to default behaviour
  return constraints.filter(c => c.severity === 'critical' || c.severity === 'important');
}

// ---------------------------------------------------------------------------
// Main injector
// ---------------------------------------------------------------------------

export function injectConstraints(task: string, ctx: InjectionContext, skills?: ScoredSkill[]): string {
  const filtered = filterByProfile(ctx.constraints, ctx.profile);
  const blockHooks = ctx.hooks.filter(h => h.mode === 'block');

  const lines: string[] = [];

  lines.push('# Reins Constraint Harness');
  lines.push('');
  lines.push('## Task');
  lines.push(task);
  lines.push('');

  // Skills section
  if (skills && skills.length > 0) {
    lines.push('## Active Skills (auto-loaded)');
    lines.push('');
    for (const skill of skills) {
      lines.push(`### ${skill.entry.title}`);
      lines.push(`Source: ${skill.entry.sourcePath}`);
      lines.push('');
      lines.push(skill.content);
      lines.push('');
    }
  }

  lines.push('## Active Constraints');
  if (filtered.length === 0) {
    lines.push('_No constraints active for this profile._');
  } else {
    filtered.forEach((c, i) => {
      lines.push(`${i + 1}. [${c.severity.toUpperCase()}] **${c.id}**: ${c.rule}`);
    });
  }
  lines.push('');

  lines.push('## Active Block-Mode Hooks');
  if (blockHooks.length === 0) {
    lines.push('_No block-mode hooks active._');
  } else {
    for (const h of blockHooks) {
      lines.push(`- ${h.constraintId} (${h.hookType}): ${h.scriptPath}`);
    }
  }
  lines.push('');

  lines.push('## Pipeline Stage Sequence');
  const stages = ctx.pipeline.stages.length > 0
    ? ctx.pipeline.stages
    : ['HARNESS_INIT', 'EXECUTION', 'QA'];
  stages.forEach((stage, i) => {
    lines.push(`${i + 1}. ${stage}`);
  });
  lines.push('');

  return lines.join('\n');
}
