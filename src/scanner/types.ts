export interface StackInfo {
  language: string[];
  framework: string[];
  buildTool: string;
  testFramework: string;
  packageManager: string;
}

export interface ArchitectureInfo {
  pattern: string;
  layers: string[];
  entryPoints: string[];
}

export interface ConventionsInfo {
  naming: string;
  fileStructure: string;
  importStyle: string;
  configFormat: string;
}

export interface ExistingRulesInfo {
  linter: Record<string, unknown> | null;
  formatter: Record<string, unknown> | null;
  typeCheck: boolean;
  cicd: Record<string, unknown> | null;
}

export interface TestingInfo {
  framework: string;
  pattern: string;
  coverage: number | null;
  fixtures: string[];
}

export interface DirectoryEntry {
  path: string;
  depth: number;
}

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  projectRoot: string;
  directories: DirectoryEntry[];
  files: FileEntry[];
  hash: string;
}

export interface KeyFilesInfo {
  readme: string | null;
  contributing: string | null;
  changelog: string | null;
  lockfile: string | null;
}

export interface ResolvedCommand {
  command: string;
  source: 'script' | 'convention' | 'taskrunner' | 'docs' | 'skill' | 'user';
  confidence: number; // 0-1
}

export interface CommandMap {
  install: ResolvedCommand | null;
  dev: ResolvedCommand | null;
  build: ResolvedCommand | null;
  lint: ResolvedCommand | null;
  lintFix: ResolvedCommand | null;
  test: ResolvedCommand | null;
  testSingle: ResolvedCommand | null;
  typecheck: ResolvedCommand | null;
  format: ResolvedCommand | null;
  formatCheck: ResolvedCommand | null;
  clean: ResolvedCommand | null;
}

export interface PackageInfo {
  name: string;
  path: string;
  stack: Partial<StackInfo>;
  commands: CommandMap;
}

export function emptyCommandMap(): CommandMap {
  return {
    install: null, dev: null, build: null, lint: null, lintFix: null,
    test: null, testSingle: null, typecheck: null, format: null,
    formatCheck: null, clean: null,
  };
}

export interface CodebaseContext {
  stack: StackInfo;
  architecture: ArchitectureInfo;
  conventions: ConventionsInfo;
  existingRules: ExistingRulesInfo;
  testing: TestingInfo;
  structure: {
    directories: DirectoryEntry[];
    files: FileEntry[];
  };
  keyFiles: KeyFilesInfo;
  commands: CommandMap;
  packages: PackageInfo[];
}

export function emptyCodebaseContext(): CodebaseContext {
  return {
    stack: { language: [], framework: [], buildTool: '', testFramework: '', packageManager: '' },
    architecture: { pattern: 'unknown', layers: [], entryPoints: [] },
    conventions: { naming: 'unknown', fileStructure: 'unknown', importStyle: 'unknown', configFormat: 'unknown' },
    existingRules: { linter: null, formatter: null, typeCheck: false, cicd: null },
    testing: { framework: '', pattern: '', coverage: null, fixtures: [] },
    structure: { directories: [], files: [] },
    keyFiles: { readme: null, contributing: null, changelog: null, lockfile: null },
    commands: emptyCommandMap(),
    packages: [],
  };
}
