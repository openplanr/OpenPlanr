#!/usr/bin/env node

import {
  createHash,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compileOperateContractRegistry,
  renderOperateContractCatalogModule,
} from '../lib/operate/contracts/compiler.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = 'registry/operate-v2-contracts.json';
const CUSTODY_PATH = 'lib/generated/operate-contract-custody-v1.5.json';


export class OperateContractGenerationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperateContractGenerationError';
    this.code = code;
    this.details = details;
  }
}

function readRegistry(projectRoot) {
  const path = resolve(projectRoot, REGISTRY_PATH);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_REGISTRY_READ',
      `Cannot read the canonical Operate registry at ${REGISTRY_PATH}.`,
      { cause: error instanceof Error ? error.message : String(error), path },
    );
  }
}

function targetPath(projectRoot, registry) {
  const target = registry?.generation?.catalogPath;
  if (typeof target !== 'string' || target.length === 0) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_TARGET',
      'The canonical Operate registry does not declare generation.catalogPath.',
    );
  }
  const resolved = resolve(projectRoot, target);
  const relativeTarget = relative(projectRoot, resolved).split(sep).join('/');
  if (relativeTarget.startsWith('../') || relativeTarget === '..' || !relativeTarget.startsWith('lib/protocol/generated/')) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_TARGET',
      'The canonical Operate catalog target must remain below lib/protocol/generated/.',
      { target },
    );
  }
  return { target, resolved };
}

function renderContractPackageInventory(catalog) {
  const files = new Set([
    'package.json',
    REGISTRY_PATH,
    CUSTODY_PATH,
    catalog.generation.catalogPath,
    catalog.generation.packageInventoryPath,
    ...catalog.contracts.map(({ schemaPath }) => schemaPath),
    ...catalog.experience.contracts.map(({ schemaPath }) => schemaPath),
    ...catalog.generation.verifiedTargets.map(({ path }) => path),
  ]);
  return `${JSON.stringify({
    kind: 'operate-contract-package-inventory',
    schemaVersion: '1.0.0',
    protocolVersion: catalog.protocol.version,
    files: [...files].sort((left, right) => left.localeCompare(right)),
  }, null, 2)}\n`;
}

function verifiedTargetDigests(projectRoot, registry) {
  const expected = new Map(registry.generation.verifiedTargets.map(({ path, sha256 }) => [path, sha256]));
  const custodyPath = resolve(projectRoot, CUSTODY_PATH);
  if (!existsSync(custodyPath)) return expected;

  let custody;
  try {
    custody = JSON.parse(readFileSync(custodyPath, 'utf8'));
  } catch (error) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_CUSTODY',
      `Cannot read the additive Operate custody manifest at ${CUSTODY_PATH}.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const registryDigest = sha256Text(readFileSync(resolve(projectRoot, REGISTRY_PATH), 'utf8'));
  if (
    custody?.kind !== 'operate-contract-generated-custody'
    || custody?.schemaVersion !== '1.0.0'
    || custody?.protocolVersion !== '1.5.0'
    || custody?.legacyRegistrySha256 !== registryDigest
    || !Array.isArray(custody.overrides)
  ) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_CUSTODY',
      'The additive Operate custody manifest is malformed or bound to another legacy registry.',
    );
  }
  const seen = new Set();
  for (const override of custody.overrides) {
    const legacy = registry.generation.verifiedTargets.find(({ path }) => path === override?.path);
    if (
      !legacy
      || seen.has(override.path)
      || override.legacySha256 !== legacy.sha256
      || !/^[0-9a-f]{64}$/u.test(override.sha256 ?? '')
      || typeof override.custody !== 'string'
      || override.custody.length === 0
    ) {
      throw new OperateContractGenerationError(
        'E_OPERATE_CONTRACT_CUSTODY',
        `Invalid additive custody override for ${String(override?.path)}.`,
      );
    }
    seen.add(override.path);
    expected.set(override.path, override.sha256);
  }
  return expected;
}

function canonicalText(bytes) {
  return bytes.replace(/\r\n/gu, '\n');
}

function sha256Text(bytes) {
  return createHash('sha256').update(canonicalText(bytes), 'utf8').digest('hex');
}

function parseArgs(argv) {
  const flags = new Set(argv);
  if (argv.length !== flags.size || [...flags].some((flag) => !['--write', '--check'].includes(flag))) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_ARGUMENT',
      'Use exactly one of --write or --check.',
    );
  }
  if (flags.size !== 1) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_ARGUMENT',
      'Use exactly one of --write or --check.',
    );
  }
  return { mode: flags.has('--write') ? 'write' : 'check' };
}

export function renderOperateContractAssets({ projectRoot = root } = {}) {
  const registry = readRegistry(projectRoot);
  const { target } = targetPath(projectRoot, registry);
  const catalog = compileOperateContractRegistry(registry);
  return {
    assets: {
      [target]: renderOperateContractCatalogModule(registry),
      [catalog.generation.packageInventoryPath]: renderContractPackageInventory(catalog),
    },
    verifiedTargets: catalog.generation.verifiedTargets,
    publicProjectionIdentities: catalog.operatingIntelligence.projectionIdentities,
    governedExecutionContractIds: catalog.governedExecution.contractIds,
    experienceContractIds: catalog.experience.contracts.map(({ id }) => id),
    deliveryRoutes: catalog.experience.deliveryRoutes,
  };
}

export function runOperateContractGenerator({
  argv = process.argv.slice(2),
  projectRoot = root,
} = {}) {
  const { mode } = parseArgs(argv);
  const { assets, verifiedTargets } = renderOperateContractAssets({ projectRoot });
  const currentVerifiedDigests = verifiedTargetDigests(projectRoot, readRegistry(projectRoot));
  const staleGeneratedTargets = Object.entries(assets)
    .filter(([target, expected]) => {
      const path = resolve(projectRoot, target);
      return !existsSync(path) || canonicalText(readFileSync(path, 'utf8')) !== canonicalText(expected);
    })
    .map(([target]) => target)
    .sort();

  const staleVerifiedTargets = verifiedTargets
    .filter(({ path, sha256 }) => {
      const target = resolve(projectRoot, path);
      const expected = currentVerifiedDigests.get(path) ?? sha256;
      return !existsSync(target) || sha256Text(readFileSync(target, 'utf8')) !== expected;
    })
    .map(({ path }) => path)
    .sort();
  const staleTargets = [...new Set([...staleGeneratedTargets, ...staleVerifiedTargets])].sort();

  if (mode === 'check') {
    if (staleTargets.length > 0) {
      throw new OperateContractGenerationError(
        'E_OPERATE_CONTRACT_DRIFT',
        `Generated Operate contract targets are stale:\n${staleTargets.map((target) => `  - ${target}`).join('\n')}\nRun: npm run generate:operate-contracts`,
        { staleTargets },
      );
    }
    return { ok: true, mode, staleTargets: [] };
  }

  if (staleVerifiedTargets.length > 0) {
    throw new OperateContractGenerationError(
      'E_OPERATE_CONTRACT_DRIFT',
      `Verified Operate contract targets are stale:\n${staleVerifiedTargets.map((target) => `  - ${target}`).join('\n')}\nUpdate the canonical registry digest after reviewing the intended contract change.`,
      { staleTargets: staleVerifiedTargets },
    );
  }

  const written = [];
  for (const [target, expected] of Object.entries(assets).sort(([left], [right]) => left.localeCompare(right))) {
    const path = resolve(projectRoot, target);
    if (!existsSync(path) || canonicalText(readFileSync(path, 'utf8')) !== canonicalText(expected)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, expected, 'utf8');
      written.push(target);
    }
  }
  return { ok: true, mode, written, staleTargets: staleGeneratedTargets };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runOperateContractGenerator();
    process.stdout.write(
      result.mode === 'check'
        ? 'Operate contract assets are current.\n'
        : `Generated ${result.written.length} Operate contract catalog target${result.written.length === 1 ? '' : 's'}.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.code ?? 'E_OPERATE_CONTRACT_GENERATION'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
