import { readFileSync } from 'node:fs';
import { readStandardSkillPackage } from '../../packages/skill-runtime/src/catalog.mjs';
import { renderOpenAiSkillMetadata } from '../../packages/skill-runtime/src/packaging/index.mjs';
import { projectedSkillName, renderNamespacedSkill } from './host-invocations.mjs';

/** Standalone downloads have their own canonical closure, independent of native suite layout. */
export function buildStandaloneSkillEntries({ repoRoot, registryRow }) {
  const packageInfo = readStandardSkillPackage({ repoRoot, registryRow });
  const entries = [
    {
      path: 'LICENSE',
      bytes: readFileSync(`${repoRoot}/LICENSE`),
      mode: 0o644,
    },
    {
      path: 'SKILL.md',
      bytes: Buffer.from(renderNamespacedSkill(packageInfo.markdown, registryRow.skillId)),
      mode: 0o644,
    },
    {
      path: 'openplanr.skill.json',
      bytes: Buffer.from(`${JSON.stringify(packageInfo.manifest, null, 2)}\n`),
      mode: 0o644,
    },
    ...packageInfo.resources.map((resource) => ({
      path: resource.path,
      bytes:
        resource.path === 'agents/openai.yaml'
          ? Buffer.from(
              renderOpenAiSkillMetadata({
                skillId: registryRow.skillId,
                description: registryRow.description,
                invocation: `$${projectedSkillName(registryRow.skillId)}`,
              }),
            )
          : readFileSync(resource.absolute),
      mode: resource.executable ? 0o755 : 0o644,
    })),
  ];
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** A byte-consistent ZIP/tree pair must also be the complete canonical standalone product. */
export function verifyStandaloneSkillEntries({ repoRoot, registryRow, entries }) {
  const expected = buildStandaloneSkillEntries({ repoRoot, registryRow });
  const actual = new Map(entries.map((entry) => [entry.path, entry]));
  if (actual.size !== entries.length || actual.size !== expected.length)
    throw new Error(
      `${registryRow.skillId} standalone inventory is incomplete or has extra files.`,
    );
  for (const entry of expected) {
    const value = actual.get(entry.path);
    if (
      !value ||
      !entry.bytes.equals(Buffer.from(value.bytes)) ||
      (entry.mode & 0o777) !== (value.mode & 0o777)
    )
      throw new Error(
        `${registryRow.skillId}/${entry.path} differs from its canonical standalone closure.`,
      );
  }
  return { files: expected.length };
}
