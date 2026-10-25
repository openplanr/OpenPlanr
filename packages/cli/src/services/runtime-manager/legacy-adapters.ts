import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CLI_COMMAND } from '../../utils/constants.js';
import { RuntimeManagerError } from './errors.js';
import type { InstallScope } from './global-state.js';
import type { PlannedFileAction as FileAction } from './install-plan.js';
import type { RuntimeId } from './inventory.js';

export const RETIRED_CURSOR_WORKFLOW_RULES = [
  'planr-pipeline.mdc',
  'planr-pipeline-plan.mdc',
  'planr-pipeline-ship.mdc',
] as const;

export const RETIRED_CURSOR_AGENT_RULES = [
  'backend-agent.md',
  'db-agent.md',
  'designer-agent.md',
  'devops-agent.md',
  'doc-gen-agent.md',
  'entity-scaffold-agent.md',
  'frontend-agent.md',
  'qa-agent.md',
  'specification-agent.md',
] as const;

// Exact historical source bytes protect edited copies that retain generated headers.
export const RETIRED_CLAUDE_AGENT_HASHES: Readonly<Record<string, ReadonlySet<string>>> = {
  'backend-agent.md': new Set([
    '15e5bbd007bbc8ce6ec523f25395a7086aac12a15078a3cb5fcc2b749d2b31ad',
    '4bb7c07f52679fcf74591e38ef11d72e2c8b06caf9b8824e616de6e0fde6e8b9',
    '88a2fa5cde2d9e8d435cf1db2b338cf879076cc85b6d44353c4e724737666de2',
    'b4ebed5f3212e4f2f9204e8fcd90abd7c95ba94ca947806362b9b383257c3736',
    'd2304873971c3298471b9f20996e663c2a9b22d7527ac7b5ce21e11c522ce845',
    'dbcdc9cf6356ed962b51fa2851cd03440483d728f3c2f7cbc7cde5fe44c10cd9',
    'fd5fec86ded2c9b0576542955e40b0f4fdd7ead0b99955b4aa50c4ceb7de99c7',
  ]),
  'db-agent.md': new Set([
    '267d3e2cc28a35fa8ca847d30f8754b5c2c92de5bfcbddd8bf604fcc9e432818',
    '3a1c96edc87e0bf6c2e03887b252949a8a4d4063dbb49b549ccf4559d15b1980',
    '5266b49010553248095018deb458724f93cd6dcd54ac37e1f7d622dc06a34a84',
    '72dd671644b667c5952a7f473b7ea023698285194a90620c35bf79603dd43b03',
    'b9defd9647e7ca99f5a9ea3d509a2691e3a93f7085297060e8853e3fdb919624',
    'c996bdf5bdf4bf62c22366e11e8f2680c236630f26af82152cd93e60ffeddae2',
  ]),
  'designer-agent.md': new Set([
    '397506344856ba03baa2f88d7f76d378bd45f42994ef8261573c16b7ff3d333c',
    '54914437f54a28864e4943055373797708e4745ad25a29847506ce836a68a973',
    '5d8de63992781cc8cfff031b6c583db16ef229c35a10f48ee9dac8b8e4ed2cdf',
    '7e60b0995adc79a20eec76558a31e19797d60e972b47ce5ea8872c764625efee',
    'bbdf46fe10d67a7ce3efb6b7bd5bb17a8f6ffb6c7e8af2d4e4471701e285e69c',
    'c28dad5d80165a984f87ae9c663c7020d01b9babd1991347ff29e24e3569fb01',
    'c4b619aaa76d841347d1f400b3952662ce6ecef84bd266a5aa35489d508dbb7c',
    'c923cdba07b33dbb202154f0a6ed48c9f56a555b84910c87d5006c08e9b62ff1',
    'd1765ea268ca8b52c1ac15b4243949cd75e4db44f929fd45b00b0df234f85949',
    'f15c18fdd183f550a18351ba5fafd897be0e1d532f930995151328dd171f4414',
  ]),
  'devops-agent.md': new Set([
    '00c2c201320d230e947699e6d5ae9ea4e16766a62267535644e27c558ac2a2a7',
    '7a755a1a8869a3fed586c9222944884be34e7c46a714ce9b36c4072ccec507ab',
    'a7a0a6601228cfa131766e7bbeba2af0fbfcd037c9addca572f9858d377a1548',
    'c4bb60c762212aba7b3af8526a7e4a42d4299ae3a97b841a1395988f33b84694',
    'e9c38e820c0d762856afcac82bfc220f1891bb21586c1393104ef8dd638bc109',
    'faf485d800cb9e77cb66d41ecbc3d319598d185a68a73b96f0c29639c58ccc02',
  ]),
  'doc-gen-agent.md': new Set([
    '23f09d3c24da10e3b3d65aa38f0367861a4bea1fec1ca954ddb4bb2a28fbdaf1',
    '40b2c246586923faf2b9a42f348cacd0720840066dcd992e2fc853c4c20a1abf',
    '5a08d63991df7d765f7c86c28472f40d97dea4a451be8af28c5934c07c660f6a',
    '937557e194aaaff7cc8ccce4da7e1b0ed66be9b1b4100ee0ca3526db25b35b47',
    '987e7a9ee67fdbc3c7bc1ee5fa73e5b682169aa8b2da12e9c1d2f3d96086ee51',
    'efe2a4fa97c5af9649f6142ac082714be004487dbf2844dc3ce630a6140b15dc',
    'f1da5718235b7403ee4c5cd7e4a9227f533a38d8dcd9c24295aad4e36882b537',
  ]),
  'entity-scaffold-agent.md': new Set([
    '8c55beaeaa3f0073055d070c0f395ec12f81026c19c50de77123230df5f5dadf',
    '8f270f0015455a937a514e01074d8f686a14312da5d23a836d3f2b454dd5e439',
    'c1d9d8d3e808e90990119ecbadfa051279a6b0f6052e441b580719daa4d6828c',
    'e11d58a08d62b5d72158486ced1aeee1ad4832865a6a0689289397be3b3620d8',
    'f48c2bcf361c1d3a5486cb6f92e9416bc675bc3e6f9bfb31cbde0dc9b40e415c',
  ]),
  'frontend-agent.md': new Set([
    '0dedae59263899e89977fa1f2ff5f4a73baca78a74a2b4a1d0e31b67df1bb795',
    '131d0cdd6de828fef5eecd4ced4c2617a05c14e57528c623b278b830e5b3600a',
    '143a9c274cbf6185dd1e412c9298e7624f516ba4a13e77021ae361807c95420b',
    '3e2928403ac8d05709c06a2fd9b50f68460b634e97e0f808d6fd7d5312d8e5e3',
    '729ad4dd40724756238d1a5b847cbd80d1ec44b5ccb0ca9722bfae356812bdf1',
    'd56eb0e44e915b9c0677fc2f6a356ebb476b25b8bbb05450291b5bd57d736fe1',
    'd97e0aceafe1ba69a9aa30e9a3e08435ea42da0c53d19fc20a2d9c2343e84200',
  ]),
  'qa-agent.md': new Set([
    '099cb71c2614a9cbd716b9ea3c3dc8a20015577a4ead2baf2d15559873d50061',
    '14961f2223c551261ad57afd1758e6dff75c3613ebda2e1af9541678744fb84e',
    '1f232804251183cee693368edfdfa68d36d27c5cc3dc142e70cb8d0fe3fda142',
    '232637664acf0853751996ac8ff6960bdfbc8f200d7ccdce54ac020a0edc57f0',
    '31f66c811e13ca699c935e1281abfe9014005a82e2081e1179b81ba30fc320e7',
    '50f0e7a053bbd7fdf4732db7fd9cf95171ec383d2162ab9e2f9a09213640cf56',
    '6d3fe82bacda66070ff092cf26475fba62f840f5c3b1d832dffc416c03206427',
    'cf0f930e5a52f96bce4a8c2d1f2ecae0dd09da92c90f772495338bb47ff395d7',
    'eef2cc407f35ffcb1b3c0d28e2a47d65146287489f1a27e82d5fc6228155049e',
    'f70a6dbc51987e1355dcd883eec38c28dbac28c3f07c19eea995bab2c46c2ee1',
  ]),
  'specification-agent.md': new Set([
    '0c9294eb8006a5afb9248173a4fd1c532a60855d473efeeab2d5451dd7a13639',
    '26d5566614b235317dbb99fb8fb0f4ad7a1a0e850d5312c5490b06cf0393b308',
    '2907d954b1c1f1e522c0571ca7b9b17ae45a1707bee452b840e359c14bcb1f13',
    '2b51b2a6df1b45a8e3d3bc44f1770cf418762cb8a48f7d0d149b32cb46783c3a',
    '3779922b561a348d098b43e48e553b3ad45353c48e966f4f27cf12589f2655d8',
    '61da3e9aa6642c0115eaeef521c7bef011f1b00dcd1ec2ebfd9e2a1edbac7a0c',
    '700573a91f16bf93d1b01c31b11ca9f7d0bcad2002273610f4395eba430831f1',
    'bb8f3dd48f3f8ce541bf91d00f9041cc60cc1643d1bd4cdd6b8e96aeed68be35',
    'c1ef8e650b47780db30321d170659bbfcecdce9ba951009d36b6a29e36b77f96',
    'f5e61f62309a5df19c89c2c174e04226193c151fda49c105fad679ff6f856b3b',
    'fef7a6bc3fa946d38ac2e5124a0bb087ede2f1491a5eed6af5f74eb334003ff1',
  ]),
};

function isRetiredGeneratedCursorRule(target: string, content: Buffer): boolean {
  const source = content.toString('utf8');
  const parent = path.basename(path.dirname(target));
  if (parent === 'agents') {
    const [header, provenance] = source.split(/\r?\n/u);
    return (
      header ===
        '> **Cursor adapter — synthesized from planr-pipeline.** Agent role system prompt (body-only). Used by `/cursor/rules/planr-pipeline.mdc` for Composer subagent dispatch.' &&
      typeof provenance === 'string' &&
      provenance.startsWith('> Source: `planr-pipeline/agents/')
    );
  }
  const generatedFooter = source.trimEnd().split(/\r?\n/u).at(-1) ?? '';
  const deprecatedAlias =
    '---\ndescription: Deprecated OpenPlanr pipeline alias\nalwaysApply: false\n---\n\nThis compatibility alias is deprecated. Use the portable `openplanr.mdc` rule.\n';
  return (
    (generatedFooter.startsWith(
      `*Generated by \`${CLI_COMMAND} rules generate --target cursor --scope pipeline\`.`,
    ) &&
      generatedFooter.endsWith('*')) ||
    source === deprecatedAlias
  );
}

export function planRetiredCursorProjectRules(
  projectDir: string,
  runtimes: RuntimeId[],
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>,
): FileAction[] {
  if (
    !runtimes.includes('cursor') ||
    !['project', 'both'].includes(runtimeScopes.cursor ?? 'project')
  ) {
    return [];
  }
  const rulesRoot = path.join(projectDir, '.cursor', 'rules');
  const candidates = [
    ...RETIRED_CURSOR_WORKFLOW_RULES.map((name) => path.join(rulesRoot, name)),
    ...RETIRED_CURSOR_AGENT_RULES.map((name) => path.join(rulesRoot, 'agents', name)),
  ];
  return candidates.flatMap((target) => {
    if (!existsSync(target)) return [];
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Retired Cursor workflow path is not one regular generated file: ${target}.`,
        'Move the foreign path aside and rerun setup.',
      );
    }
    const content = readFileSync(target);
    if (!isRetiredGeneratedCursorRule(target, content)) return [];
    return [
      {
        runtime: 'cursor' as const,
        scope: 'project' as const,
        target,
        content,
        kind: 'file' as const,
        description: 'Retire an unreachable generated Cursor workflow copy',
      },
    ];
  });
}

export function planRetiredClaudeProjectAgents(
  projectDir: string,
  runtimes: RuntimeId[],
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>,
): FileAction[] {
  if (
    !runtimes.includes('claude-code') ||
    !['project', 'both'].includes(runtimeScopes['claude-code'] ?? 'project')
  ) {
    return [];
  }
  return Object.entries(RETIRED_CLAUDE_AGENT_HASHES).flatMap(([name, hashes]) => {
    const target = path.join(projectDir, '.claude', 'agents', name);
    if (!existsSync(target)) return [];
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return [];
    const content = readFileSync(target);
    if (!hashes.has(createHash('sha256').update(content).digest('hex'))) return [];
    return [
      {
        runtime: 'claude-code' as const,
        scope: 'project' as const,
        target,
        content,
        kind: 'file' as const,
        description: 'Retire a duplicate generated Claude role agent',
      },
    ];
  });
}
