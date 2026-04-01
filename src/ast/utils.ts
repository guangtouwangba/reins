export function classifyNamingStyle(name: string): string {
  if (!name || name.startsWith('_') || name.startsWith('$')) return 'other';
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return 'UPPER_SNAKE';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) return 'camelCase';
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) return 'snake_case';
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) return 'kebab-case';
  if (/^[a-z][a-z0-9]*$/.test(name)) return 'camelCase';
  return 'other';
}
