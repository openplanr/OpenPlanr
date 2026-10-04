import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStandardSkillPackage } from '../../packages/skill-runtime/src/catalog.mjs';
import { suiteLocalResources, suiteSharedResources } from './suite-resources.mjs';

/** Compare projected entry resources and every shared byte with their canonical closure. */
export function verifySuiteResources({ repoRoot, registryRow, host, pluginRoot, skillRoot }) {
  const packageInfo = readStandardSkillPackage({ repoRoot, registryRow });
  const local = suiteLocalResources(packageInfo, host, skillRoot);
  const shared = suiteSharedResources(packageInfo, host, skillRoot);
  const localPaths = new Set(local.map(({ path }) => path));
  for (const resource of local) {
    if (host === 'codex' && resource.path === 'agents/openai.yaml') continue;
    if (host === 'cursor' && resource.path.startsWith('agents/')) continue;
    const path = resolve(pluginRoot, skillRoot, resource.path);
    if (!existsSync(path) || !readFileSync(path).equals(resource.bytes))
      throw new Error(
        `${host}/${registryRow.skillId}/${resource.path} lost its canonical projection.`,
      );
  }
  for (const resource of shared) {
    const path = resolve(pluginRoot, resource.path);
    if (!existsSync(path) || !readFileSync(path).equals(resource.bytes))
      throw new Error(`${host}/${resource.path} differs from its canonical runtime resource.`);
  }
  for (const resource of packageInfo.resources.filter(({ hosts }) => hosts.includes(host))) {
    if (!localPaths.has(resource.path) && existsSync(resolve(pluginRoot, skillRoot, resource.path)))
      throw new Error(
        `${host}/${registryRow.skillId}/${resource.path} duplicates a shared runtime resource.`,
      );
  }
  return { local, shared };
}
