import type { ArchitectureInfo, ConventionsInfo } from './types.js';

export interface PatternResult {
  architecture: Partial<ArchitectureInfo>;
  conventions: Partial<ConventionsInfo>;
}

export function analyzePatterns(filePaths: string[], dirPaths: string[]): PatternResult {
  return {
    architecture: inferArchitecture(dirPaths, filePaths),
    conventions: inferConventions(filePaths, dirPaths),
  };
}

function inferArchitecture(dirs: string[], files: string[]): Partial<ArchitectureInfo> {
  const result: Partial<ArchitectureInfo> = {};

  // Check monorepo
  if (dirs.some(d => /^(packages|apps|modules)\//.test(d) || /^(packages|apps|modules)$/.test(d))) {
    result.pattern = 'monorepo';
  }
  // Check microservice
  else if (
    files.some(f => f === 'docker-compose.yml' || f === 'docker-compose.yaml') &&
    dirs.filter(d => /service/i.test(d) && d.split('/').length <= 2).length > 1
  ) {
    result.pattern = 'microservice';
  }
  // Check layered
  else {
    const layerNames = ['api', 'service', 'services', 'repository', 'repositories', 'model', 'models', 'controller', 'controllers'];
    const matchedLayers = layerNames.filter(l =>
      dirs.some(d => {
        const parts = d.split('/');
        return parts.some(p => p.toLowerCase() === l);
      })
    );
    if (matchedLayers.length >= 3) {
      result.pattern = 'layered';
      result.layers = matchedLayers;
    } else {
      result.pattern = 'monolith';
    }
  }

  // Detect entry points
  const entryPatterns = ['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js', 'index.ts', 'index.js', 'main.go', 'src/main.rs'];
  result.entryPoints = files.filter(f => entryPatterns.includes(f));

  return result;
}

function inferConventions(files: string[], dirs: string[]): Partial<ConventionsInfo> {
  const result: Partial<ConventionsInfo> = {};

  // Naming convention from source files
  const sourceFiles = files
    .filter(f => /\.(ts|tsx|js|jsx|py|go|rs)$/.test(f))
    .map(f => f.split('/').pop() ?? '')
    .filter(f => !f.startsWith('.'));

  let camelCount = 0;
  let snakeCount = 0;
  let pascalCount = 0;
  let kebabCount = 0;

  for (const name of sourceFiles) {
    const base = name.replace(/\.(ts|tsx|js|jsx|py|go|rs)$/, '');
    if (/^[a-z][a-zA-Z0-9]*$/.test(base) && /[A-Z]/.test(base)) camelCount++;
    else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(base)) snakeCount++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(base)) pascalCount++;
    else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(base)) kebabCount++;
  }

  const max = Math.max(camelCount, snakeCount, pascalCount, kebabCount);
  if (max === 0) result.naming = 'unknown';
  else if (max === camelCount) result.naming = 'camelCase';
  else if (max === snakeCount) result.naming = 'snake_case';
  else if (max === pascalCount) result.naming = 'PascalCase';
  else result.naming = 'kebab-case';

  // File structure
  const maxDepth = dirs.reduce((max, d) => Math.max(max, d.split('/').length), 0);
  const hasFeatureDirs = dirs.some(d => /features?\//.test(d));

  if (hasFeatureDirs) result.fileStructure = 'feature-based';
  else if (maxDepth <= 2) result.fileStructure = 'flat';
  else if (dirs.some(d => /^(src\/)?(api|service|model|controller|repository)/.test(d))) {
    result.fileStructure = 'layer-based';
  } else result.fileStructure = 'nested';

  // Config format
  const hasYaml = files.some(f => /\.(yaml|yml)$/.test(f) && !f.includes('node_modules'));
  const hasToml = files.some(f => f.endsWith('.toml'));
  const hasEnv = files.some(f => f.startsWith('.env'));

  if (hasYaml) result.configFormat = 'yaml';
  else if (hasToml) result.configFormat = 'toml';
  else if (hasEnv) result.configFormat = 'env';
  else result.configFormat = 'json';

  return result;
}
