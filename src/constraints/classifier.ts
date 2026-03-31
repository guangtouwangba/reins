import type { Constraint, Severity } from './schema.js';

interface ClassificationRule {
  pattern: RegExp;
  severity: Severity;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // critical: security, data loss, build-fail patterns
  { pattern: /database|sql|query|inject/i, severity: 'critical' },
  { pattern: /secret|password|credential|token|api.?key/i, severity: 'critical' },
  { pattern: /env(ironment)?\s*var|dotenv/i, severity: 'critical' },
  { pattern: /build.fail|crash|panic|fatal|corrupt/i, severity: 'critical' },
  { pattern: /no.?bare.?except|bare\s+except/i, severity: 'critical' },
  { pattern: /direct.?sql|raw.?sql|prisma/i, severity: 'critical' },
  // important: architecture, layering, naming patterns
  { pattern: /architect|layer|service|repository|controller/i, severity: 'important' },
  { pattern: /naming|convention|format|style/i, severity: 'important' },
  { pattern: /test|coverage|fixture|spec/i, severity: 'important' },
  { pattern: /strict.?mode|no.?any|return.?type|type.?hint/i, severity: 'important' },
  { pattern: /error.?handling|typed.?error|exception/i, severity: 'important' },
  { pattern: /import|module|depend/i, severity: 'important' },
  // helpful: template, preference, example patterns
  { pattern: /prefer|recommend|example|reference|template/i, severity: 'helpful' },
  { pattern: /context.?first|order|prefer.?const/i, severity: 'helpful' },
];

/**
 * Classify a constraint's severity based on its rule text.
 * If the constraint has enforcement.hook === true, severity is never below 'critical'.
 */
export function classifyConstraint(constraint: Omit<Constraint, 'severity'>): Severity {
  const rule = constraint.rule;

  for (const { pattern, severity } of CLASSIFICATION_RULES) {
    if (pattern.test(rule)) {
      // If hook is set, enforce minimum of 'important'
      if (constraint.enforcement.hook && severity === 'helpful') {
        return 'important';
      }
      return severity;
    }
  }

  // Default fallback
  if (constraint.enforcement.hook) {
    return 'critical';
  }
  return 'helpful';
}
