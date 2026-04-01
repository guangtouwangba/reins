import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface PackageEntry {
  name: string;
  path: string;
}

/**
 * Detect workspace packages from package.json workspaces field.
 * Returns an array of { name, path } for each discovered workspace package.
 */
export function detectWorkspaces(projectRoot: string): PackageEntry[] {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      workspaces?: string[] | { packages?: string[] };
    };

    let patterns: string[] = [];
    if (Array.isArray(pkg.workspaces)) {
      patterns = pkg.workspaces;
    } else if (pkg.workspaces?.packages) {
      patterns = pkg.workspaces.packages;
    }

    if (patterns.length === 0) return [];

    const results: PackageEntry[] = [];
    for (const pattern of patterns) {
      // Expand glob patterns to find workspace package.json files
      const baseDir = pattern.replace(/\/?\*+$/, '');
      const workspacePath = join(projectRoot, baseDir);
      if (!existsSync(workspacePath)) continue;

      const entries = readdirSafe(workspacePath);
      for (const entry of entries) {
        const subPkgPath = join(workspacePath, entry, 'package.json');
        if (existsSync(subPkgPath)) {
          try {
            const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf-8')) as { name?: string };
            const relativePath = baseDir ? `${baseDir}/${entry}` : entry;
            results.push({
              name: subPkg.name ?? entry,
              path: relativePath,
            });
          } catch {
            // skip unparseable package.json
          }
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}
