import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('../fixtures', import.meta.url));

export function materializePlanrFixture(name) {
  if (basename(name) !== name) throw new Error(`Invalid Planr fixture name: ${name}`);
  const sourceRoot = join(fixtureRoot, name);
  const projectRoot = mkdtempSync(join(tmpdir(), `planr-${name}-`));
  cpSync(join(sourceRoot, 'planr'), join(projectRoot, '.planr'), { recursive: true });
  if (existsSync(join(sourceRoot, 'input'))) {
    cpSync(join(sourceRoot, 'input'), join(projectRoot, 'input'), { recursive: true });
  }
  if (existsSync(join(sourceRoot, 'output'))) {
    cpSync(join(sourceRoot, 'output'), join(projectRoot, 'output'), { recursive: true });
  }
  if (existsSync(join(sourceRoot, '.codex'))) {
    cpSync(join(sourceRoot, '.codex'), join(projectRoot, '.codex'), { recursive: true });
  }
  return projectRoot;
}
