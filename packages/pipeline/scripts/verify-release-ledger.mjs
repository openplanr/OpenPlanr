#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProtocolArtifact } from '../lib/protocol/contracts.mjs';
import {
  RELEASE_MANIFEST_CLAIM_EDGES,
  RELEASE_REPOSITORY_KEYS,
  assertEcosystemManifestProjection,
  assertPipelineCompatibilityDeclaration,
  buildManifestClaimSet,
  buildReleaseLedger,
  buildReleaseLedgerReceipt,
  releaseLedgerAbsence,
  releaseLedgerRowsFromProofs,
  renderCompatibilityDisplay,
  renderLedgerVersionProjection,
} from '../lib/ecosystem/release-ledger.mjs';
import {
  assertPackedWorkspaceProof,
  readPackedWorkspaceProof,
} from '../lib/ecosystem/packed-workspace-proof.mjs';
import { discoverEcosystemRepositories, resolveWorkspaceRoot } from '../lib/ecosystem/workspace-discovery.mjs';
import { sha256Jcs } from '../lib/protocol/jcs.mjs';

const CONTRACT_VERSION = '1.3.0';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const supported = new Set(['--json', '--strict']);
const valued = ['--proof', '--workspace-root'];
const unknown = rawArgs.filter((arg, index) => (
  !supported.has(arg)
  && !valued.some((name) => arg === name || arg.startsWith(`${name}=`))
  && !valued.includes(rawArgs[index - 1])
));

const refusals = [];
const absences = [];
const derived = [];

function refuse(code, reason, repositoryKey = null) {
  refusals.push({ code, repositoryKey, reason });
}

function absent(input, reason, repositoryKey = null) {
  absences.push(releaseLedgerAbsence({ input, reason, repositoryKey }));
}

function optionValue(name) {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index === -1 ? null : rawArgs[index + 1] ?? null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

if (unknown.length > 0) {
  process.stderr.write(`Release ledger verification: unknown option ${unknown[0]}\n`);
  process.exit(1);
}

const workspace = resolveWorkspaceRoot({ pipelineRoot: root, argv: rawArgs });
const discovered = discoverEcosystemRepositories({ pipelineRoot: root, workspaceRoot: workspace.path });
const consolidated = discovered.layout === 'consolidated-monorepo';
const releasePackageKeys = consolidated ? ['pipeline', 'cli'] : RELEASE_REPOSITORY_KEYS;
const catalogDomains = consolidated ? ['skills', 'marketplace'] : [];
const externalRepositories = consolidated ? ['web'] : [];

// Each repository states its own package identity. That declaration is a label
// the ledger carries; it never becomes the identity of the bytes.
const packages = {};
for (const repositoryKey of releasePackageKeys) {
  const repository = discovered.repositories[repositoryKey];
  if (!repository) {
    absent(`candidate.${repositoryKey}`, 'repository-not-discovered', repositoryKey);
    continue;
  }
  if (repository.method === 'workspace-domain') {
    absent(`package.${repositoryKey}`, 'input-missing', repositoryKey);
    continue;
  }
  const manifestPath = join(repository.path, 'package.json');
  const declared = existsSync(manifestPath) ? readJson(manifestPath) : null;
  if (!declared) {
    absent(`package.${repositoryKey}`, existsSync(manifestPath) ? 'input-unreadable' : 'input-missing', repositoryKey);
    continue;
  }
  packages[repositoryKey] = { name: declared.name, version: declared.version, root: repository.path, raw: declared };
}

const marketplaceRoot = discovered.repositories.marketplace?.path ?? null;
const manifestPath = marketplaceRoot === null ? null : join(marketplaceRoot, 'ecosystem.json');
const manifest = manifestPath !== null && existsSync(manifestPath) ? readJson(manifestPath) : null;
const manifestShape = Array.isArray(manifest?.adapters)
  ? 'release'
  : manifest?.kind === 'openplanr-ecosystem' && Array.isArray(manifest?.adapters?.hosts)
    ? 'consolidated'
    : 'unknown';
if (manifest === null) {
  absent('manifest.ecosystem', manifestPath === null ? 'repository-not-discovered' : 'input-unreadable', 'marketplace');
} else if (manifestShape === 'release') {
  const schemaErrors = validateProtocolArtifact('ecosystem-manifest', manifest, { protocolVersion: CONTRACT_VERSION });
  if (schemaErrors.length > 0) {
    refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', `the emitted manifest does not satisfy its published contract: ${schemaErrors[0].path} ${schemaErrors[0].detail}`, 'marketplace');
  }

  for (const [component, repositoryKey] of [['cli', 'cli'], ['pipeline', 'pipeline'], ['skills', 'skills'], ['marketplace', 'marketplace']]) {
    const declared = packages[repositoryKey];
    if (!declared) continue;
    const stated = manifest.components?.[component]?.version ?? null;
    if (stated !== declared.version) {
      refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', `the manifest states ${component} ${stated} while that repository declares ${declared.version}`, repositoryKey);
    }
  }

  // Every rendered range in the published manifest must equal the deterministic
  // render of the producer row it names. A range that does not is drift, never
  // something to re-render.
  for (const edge of RELEASE_MANIFEST_CLAIM_EDGES) {
    const producer = packages[edge.producer];
    if (!producer) continue;
    const expected = renderCompatibilityDisplay({ derivation: edge.derivation, declaredVersion: producer.version });
    const rendered = edge.path.endsWith('[].pipelineRange')
      ? (manifest.adapters ?? []).map((adapter) => adapter?.pipelineRange ?? null)
      : [edge.path.split('.').reduce((value, part) => value?.[part], manifest) ?? null];
    for (const value of rendered) {
      if (value !== expected) {
        refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', `${edge.path} renders ${String(value)} where the bound ${edge.producer} row derives ${expected}`, edge.consumer);
      }
    }
    derived.push({ path: edge.path, consumer: edge.consumer, producer: edge.producer, display: expected });
  }
} else if (manifestShape === 'consolidated') {
  // The consolidated workspace manifest is an integration/preservation
  // manifest, not the frozen marketplace release-manifest contract. Verify
  // the compatibility statements it actually publishes without pretending it
  // carries the removed skills/marketplace release rows.
  for (const [component, repositoryKey] of [['cli', 'cli'], ['pipeline', 'pipeline']]) {
    const declared = packages[repositoryKey];
    if (!declared) continue;
    const stated = manifest.components?.[component]?.version ?? null;
    if (stated !== declared.version) {
      refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', `the consolidated manifest states ${component} ${stated} while that package declares ${declared.version}`, repositoryKey);
    }
  }

  const pipeline = packages.pipeline;
  if (pipeline) {
    const optionalPipeline = manifest.compatibility?.cliOptionalPipeline?.version ?? null;
    if (optionalPipeline !== pipeline.version) {
      refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', `the consolidated manifest states optional pipeline ${optionalPipeline} while that package declares ${pipeline.version}`, 'cli');
    }
    for (const host of manifest.adapters.hosts) {
      if (host?.version !== pipeline.version) {
        refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', `adapter host ${String(host?.id)} states ${String(host?.version)} while the pipeline package declares ${pipeline.version}`, 'marketplace');
      }
    }
    derived.push({
      path: 'compatibility.cliOptionalPipeline.version',
      consumer: 'cli',
      producer: 'pipeline',
      display: pipeline.version,
    });
    derived.push({
      path: 'adapters.hosts[].version',
      consumer: 'marketplace',
      producer: 'pipeline',
      display: pipeline.version,
    });
  }
} else {
  refuse('E_RELEASE_LEDGER_MANIFEST_DRIFT', 'the ecosystem manifest has neither the published release shape nor the consolidated integration shape', 'marketplace');
}

// The legacy skills repository keeps its declared compatibility string, but
// that string is resolved against the pipeline row rather than trusted. In the
// consolidated workspace skills are a generated catalog domain, not another
// published package row.
const skillsDeclaration = consolidated ? null : packages.skills?.raw?.pipelineCompatibility ?? null;
if (!consolidated) {
  if (skillsDeclaration === null) {
    absent('declaration.skills.pipelineCompatibility', 'input-missing', 'skills');
  } else if (packages.pipeline) {
    const expected = `planr-pipeline@${packages.pipeline.version}`;
    if (skillsDeclaration !== expected) {
      refuse('E_RELEASE_LEDGER_CLAIM_DRIFT', `skills declares ${skillsDeclaration} where the pipeline row carries ${packages.pipeline.version}`, 'skills');
    }
  }
}

// Payload custody comes from the proof native to the selected layout. Legacy
// workspaces retain the frozen five-repository ledger proof. The consolidated
// workspace consumes the current packed-workspace proof, which binds only its
// two public package artifacts; root skills/marketplace catalogs and the
// external web repository are intentionally not fabricated as package rows.
const proofPath = optionValue('--proof');
let ledger = null;
let claims = [];
let receipt = null;
let packedProof = null;
if (proofPath === null) {
  for (const repositoryKey of releasePackageKeys) {
    absent(`payload.${repositoryKey}`, 'payload-proof-not-supplied', repositoryKey);
  }
} else if (consolidated) {
  try {
    packedProof = assertPackedWorkspaceProof({
      proof: readPackedWorkspaceProof(resolve(proofPath)),
      workspaceRoot: workspace.path,
    });
  } catch (error) {
    refuse(
      error?.code ?? 'E_PACKED_WORKSPACE_PROOF_INVALID',
      error instanceof Error ? error.message : 'The packed-workspace proof is invalid.',
    );
  }
} else {
  const proof = readJson(resolve(proofPath));
  if (!proof?.ecosystem) {
    absent('proof.candidate', proof === null ? 'input-unreadable' : 'input-missing');
  } else {
    const assembled = releaseLedgerRowsFromProofs({
      ecosystemProof: proof.ecosystem,
      packageProof: proof.package ?? null,
      payloads: proof.payloads ?? {},
      packages: Object.fromEntries(Object.entries(packages).map(([key, value]) => [key, { name: value.name, version: value.version }])),
      terminalReceipts: proof.terminalReceipts ?? {},
    });
    absences.push(...assembled.absences);
    if (assembled.rows.length === RELEASE_REPOSITORY_KEYS.length && manifestShape === 'release') {
      ledger = buildReleaseLedger({
        generatedAt: new Date(0).toISOString(),
        rows: [...assembled.rows],
        manifestBinding: { manifestDigest: sha256Jcs(manifest), manifestSchemaVersion: '1.1.0' },
      });
      claims = buildManifestClaimSet(ledger);
      try {
        assertEcosystemManifestProjection({ ledger, claims, manifest });
        assertPipelineCompatibilityDeclaration(skillsDeclaration, {
          ledger,
          pipelinePayloadDigest: ledger.rows.find(({ repositoryKey }) => repositoryKey === 'pipeline').payloadDigest,
        });
      } catch (error) {
        refuse(error.code ?? 'E_RELEASE_LEDGER_CONTRACT_INVALID', error.message);
      }
      receipt = buildReleaseLedgerReceipt({
        ledger,
        claims,
        issuedAt: new Date(0).toISOString(),
        refusals,
      });
    }
  }
}

const strict = args.has('--strict') || process.env.OPENPLANR_STRICT_ECOSYSTEM === '1';
const ok = refusals.length === 0 && (!strict || absences.length === 0);
const report = {
  ok,
  contractVersion: CONTRACT_VERSION,
  suite: 'release-ledger',
  layout: discovered.layout,
  workspaceRoot: workspace.path === root ? '.' : workspace.source,
  releasePackageKeys: [...releasePackageKeys],
  catalogDomains,
  externalRepositories,
  packedProofDigest: packedProof?.proofDigest ?? null,
  ledgerDigest: ledger?.ledgerDigest ?? null,
  claimSetDigest: receipt?.claimSetDigest ?? null,
  receiptDigest: receipt?.receiptDigest ?? null,
  projections: derived.map(({ path, display }) => ({ path, display })),
  versionProjections: Object.entries(packages).map(([repositoryKey, value]) => ({
    repositoryKey,
    projection: renderLedgerVersionProjection({ packageName: value.name, declaredVersion: value.version }),
  })),
  refusals,
  unproven: absences.map(({ input, reason, repositoryKey }) => ({ input, reason, repositoryKey })),
};

if (args.has('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`Release ledger derivation: ${ok ? 'PASS' : 'FAIL'} (${derived.length} rendered claims derived, ${refusals.length} drift refusal(s), ${absences.length} unproven input(s))\n`);
  for (const refusal of refusals) process.stdout.write(`  refused ${refusal.code}: ${refusal.reason}\n`);
  for (const absence of absences) process.stdout.write(`  unproven ${absence.input}: ${absence.reason}\n`);
}

process.exit(ok ? 0 : 1);
