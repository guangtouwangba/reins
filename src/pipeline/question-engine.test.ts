import { describe, it, expect } from 'vitest';
import { generateQuestions, universalDimensions, filterByContext } from './question-engine.js';
import { emptyCodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

describe('question-engine', () => {
  describe('universalDimensions', () => {
    it('returns questions covering all 6 dimensions', () => {
      const qs = universalDimensions();
      const dims = new Set(qs.map(q => q.dimension));
      expect(dims.size).toBe(6);
      expect(dims).toContain('scope');
      expect(dims).toContain('users');
      expect(dims).toContain('data');
      expect(dims).toContain('error');
      expect(dims).toContain('migration');
      expect(dims).toContain('auth');
    });

    it('each question has a valid priority', () => {
      const qs = universalDimensions();
      for (const q of qs) {
        expect(['blocking', 'important', 'optional']).toContain(q.priority);
      }
    });
  });

  describe('filterByContext', () => {
    it('infers auth when auth middleware detected', () => {
      const ctx = emptyCodebaseContext();
      ctx.structure.files = [{ path: 'src/middleware/auth.ts', size: 100, mtime: 0 }];
      const { questions, inferred } = filterByContext(universalDimensions(), ctx, []);
      expect(inferred.some(f => f.dimension === 'auth')).toBe(true);
      expect(questions.every(q => q.dimension !== 'auth')).toBe(true);
    });

    it('infers ORM from constraints mentioning Prisma', () => {
      const ctx = emptyCodebaseContext();
      const constraints: Constraint[] = [{
        id: 'use-prisma', rule: 'Always use Prisma ORM for database access',
        severity: 'critical', scope: 'global', source: 'auto',
        enforcement: { soft: false, hook: false },
      }];
      const { inferred } = filterByContext(universalDimensions(), ctx, constraints);
      expect(inferred.some(f => f.dimension === 'orm')).toBe(true);
    });

    it('returns all questions when no context signals match', () => {
      const ctx = emptyCodebaseContext();
      const { questions, inferred } = filterByContext(universalDimensions(), ctx, []);
      expect(inferred).toHaveLength(0);
      expect(questions).toHaveLength(6);
    });
  });

  describe('generateQuestions', () => {
    it('categorizes questions correctly', async () => {
      const ctx = emptyCodebaseContext();
      const result = await generateQuestions('add feature', ctx, []);
      expect(result.blocking.length).toBeGreaterThan(0);
      expect(result.important.length).toBeGreaterThan(0);
      expect(result.optional.length).toBeGreaterThan(0);
      expect(result.blocking.every(q => q.priority === 'blocking')).toBe(true);
    });
  });
});
