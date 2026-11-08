import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStandardSkillPackage } from '../../packages/skill-runtime/src/catalog.mjs';
import { suiteLocalResources } from './suite-resources.mjs';

/** Compare projected entry resources with their canonical bytes. */
export function verifySuiteResources({ repoRoot, registryRow, host, pluginRoot, skillRoot }) {
  const packageInfo = readStandardSkillPackage({ repoRoot, registryRow });
  const local = suiteLocalResources(packageInfo, host);
  for (const resource of local) {
    if (host === 'codex' && resource.path === 'agents/openai.yaml') continue;
    if (host === 'cursor' && resource.path.startsWith('agents/')) continue;
    const path = resolve(pluginRoot, skillRoot, resource.path);
    if (!existsSync(path) || !readFileSync(path).equals(resource.bytes))
      throw new Error(
        `${host}/${registryRow.skillId}/${resource.path} lost its canonical projection.`,
      );
  }
  return { local };
}
