import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web installers', () => {
  const sh = readFileSync(resolve('install.sh'), 'utf8');
  const ps1 = readFileSync(resolve('install.ps1'), 'utf8');

  it('installs quietly and leaves setup for an interactive terminal', () => {
    for (const installer of [sh, ps1]) {
      expect(installer).toContain('--no-audit');
      expect(installer).toContain('--no-fund');
      expect(installer).toContain('--loglevel=error');
      expect(installer).toContain('planr setup');
    }
    expect(sh).not.toMatch(/^planr setup(?:\s|$)/m);
    expect(ps1).not.toMatch(/^& planr .*setup/m);
  });

  it('keeps the minimal installation escape hatch', () => {
    expect(sh).toContain('--omit=optional');
    expect(ps1).toContain('--omit=optional');
    expect(sh).toContain('planr setup --minimal');
    expect(ps1).toContain('planr setup --minimal');
  });
});
