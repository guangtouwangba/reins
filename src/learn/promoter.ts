// ---------------------------------------------------------------------------
// Skill lifecycle state machine
// ---------------------------------------------------------------------------

export type SkillState = 'draft' | 'active' | 'verified' | 'promoted' | 'declining' | 'archived';

export interface SkillLifecycle {
  name: string;
  state: SkillState;
  qualityScore: number;
  usageCount: number;
  successRate: number;
  file?: string;
}

// ---------------------------------------------------------------------------
// calculateQualityScore
// ---------------------------------------------------------------------------

export function calculateQualityScore(skill: SkillLifecycle): number {
  let score = skill.qualityScore;

  // Adjust based on usage success rate
  if (skill.usageCount >= 5) {
    if (skill.successRate >= 90) score = Math.min(100, score + 10);
    else if (skill.successRate < 50) score = Math.max(0, score - 20);
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// updateSkillState — deterministic state transitions
// ---------------------------------------------------------------------------

export function updateSkillState(skill: SkillLifecycle): SkillState {
  const score = calculateQualityScore(skill);

  // Archived: terminal state for dead skills
  if (score === 0) {
    return 'archived';
  }

  // Declining: score dropped below 30
  if (score <= 30) {
    return 'declining';
  }

  switch (skill.state) {
    case 'draft':
      if (score >= 70 && skill.usageCount >= 1) return 'active';
      return 'draft';

    case 'active':
      if (skill.usageCount >= 5 && skill.successRate >= 80) return 'verified';
      if (score <= 30) return 'declining';
      return 'active';

    case 'verified':
      if (score >= 90) return 'promoted';
      if (score <= 30) return 'declining';
      return 'verified';

    case 'promoted':
      if (score <= 30) return 'declining';
      return 'promoted';

    case 'declining':
      if (score === 0) return 'archived';
      if (score > 30) return 'active'; // recovered
      return 'declining';

    case 'archived':
      return 'archived';

    default:
      return skill.state;
  }
}
