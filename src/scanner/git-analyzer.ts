import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitAnalysis {
  hotDirectories: string[];
  highChurnFiles: string[];
  activeContributors: number;
  totalCommits: number;
}

// ---------------------------------------------------------------------------
// analyzeGitHistory
// ---------------------------------------------------------------------------

export function analyzeGitHistory(projectRoot: string): GitAnalysis {
  try {
    return runGitAnalysis(projectRoot);
  } catch {
    // Graceful skip if not a git repo or git unavailable
    return {
      hotDirectories: [],
      highChurnFiles: [],
      activeContributors: 0,
      totalCommits: 0,
    };
  }
}

function runGitAnalysis(projectRoot: string): GitAnalysis {
  // Get last 50 commits with changed files
  let logOutput: string;
  try {
    logOutput = execSync('git log --oneline -50', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return { hotDirectories: [], highChurnFiles: [], activeContributors: 0, totalCommits: 0 };
  }

  const commitLines = logOutput.trim().split('\n').filter(Boolean);
  const totalCommits = commitLines.length;

  // Get changed files from recent commits
  let filesOutput: string;
  try {
    filesOutput = execSync('git log --name-only --pretty=format: -50', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return { hotDirectories: [], highChurnFiles: [], activeContributors: 0, totalCommits };
  }

  // Count file changes
  const fileCounts = new Map<string, number>();
  for (const line of filesOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    fileCounts.set(trimmed, (fileCounts.get(trimmed) ?? 0) + 1);
  }

  // Top 10 high-churn files
  const highChurnFiles = Array.from(fileCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([f]) => f);

  // Directory churn: count commits per directory
  const dirCounts = new Map<string, number>();
  for (const [filePath, count] of fileCounts.entries()) {
    const dir = dirname(filePath);
    if (dir && dir !== '.') {
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + count);
    }
  }

  const hotDirectories = Array.from(dirCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);

  // Active contributors
  let contributorCount = 0;
  try {
    const shortlogOutput = execSync('git shortlog -sn --no-merges -50', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    contributorCount = shortlogOutput.trim().split('\n').filter(Boolean).length;
  } catch {
    contributorCount = 0;
  }

  return { hotDirectories, highChurnFiles, activeContributors: contributorCount, totalCommits };
}
