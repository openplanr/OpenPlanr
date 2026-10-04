import { syncGeneratedOutputs } from './projection-custody.mjs';

/** Archives and unpacked products use the same digest custody as suite projections. */
export function syncSkillRelease({ root, tree, mode, beforeWrite = () => {} }) {
  return syncGeneratedOutputs({
    root,
    scope: 'release-products',
    outputs: new Map([...tree].map(([path, { bytes }]) => [`release/${path}`, bytes])),
    executable: new Set(
      [...tree]
        .filter(([, { mode: fileMode }]) => (fileMode & 0o111) !== 0)
        .map(([path]) => `release/${path}`),
    ),
    ownedRoots: ['release'],
    mode,
    beforeWrite,
  });
}
