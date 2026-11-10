import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from './en.json';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith('.test.tsx') ? [p] : [];
  });
}

describe('i18n', () => {
  it('every literal t("…") key used in the UI has an English translation', () => {
    const missing = new Set<string>();
    for (const f of files(join(__dirname, '..'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)) {
        if (!(m[1]! in en)) missing.add(m[1]!);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
