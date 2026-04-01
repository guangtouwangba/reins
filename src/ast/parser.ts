import { extname } from 'node:path';
import { createRequire } from 'node:module';
import { LANG_MAP } from './types.js';
import type { ParsedFile } from './types.js';
import type { Parser as ParserType, Language } from 'web-tree-sitter';

let parserInstance: ParserType | null = null;
const loadedLanguages = new Map<string, Language>();

async function initParser(): Promise<ParserType> {
  if (parserInstance) return parserInstance;
  // web-tree-sitter exports { Parser, Language, Query, ... } as named exports
  // but also needs Parser.init() called as static method
  const mod = await import('web-tree-sitter');
  const P = mod.Parser;
  await P.init();
  parserInstance = new P();
  return parserInstance;
}

async function loadLanguage(langId: string): Promise<Language> {
  if (loadedLanguages.has(langId)) return loadedLanguages.get(langId)!;

  const require = createRequire(import.meta.url);
  let wasmPath: string;

  if (langId === 'typescript') {
    wasmPath = require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
  } else if (langId === 'tsx') {
    wasmPath = require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
  } else if (langId === 'javascript') {
    wasmPath = require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
  } else if (langId === 'python') {
    wasmPath = require.resolve('tree-sitter-python/tree-sitter-python.wasm');
  } else {
    throw new Error(`Unsupported language: ${langId}`);
  }

  const mod = await import('web-tree-sitter');
  const lang = await mod.Language.load(wasmPath);
  loadedLanguages.set(langId, lang);
  return lang;
}

export function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return LANG_MAP[ext] ?? null;
}

export function isSupportedFile(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

export async function parseFile(filePath: string, content: string): Promise<ParsedFile | null> {
  const langId = detectLanguage(filePath);
  if (!langId) return null;
  if (content.length > 200_000) return null;

  try {
    const p = await initParser();
    const language = await loadLanguage(langId);
    p.setLanguage(language);
    const tree = p.parse(content);
    if (!tree) return null;
    return { tree, language, langId, filePath };
  } catch {
    return null;
  }
}

export function resetParser(): void {
  parserInstance = null;
  loadedLanguages.clear();
}
