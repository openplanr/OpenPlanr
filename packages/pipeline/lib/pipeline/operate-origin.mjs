import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { assertOperatingOriginV1 } from '../protocol/operating-planning-contracts.mjs';
import { parseFrontmatter, splitFrontmatter } from '../dashboard/graph-reader.mjs';
import { PipelineError } from './errors.mjs';

function fail(message) {
  throw new PipelineError('E_OPERATING_ORIGIN_INVALID', message,
    'Repair the parent SPEC operating-origin.json before running PLAN or SHIP.');
}

export function loadSpecOperatingOrigin(specDir) {
  if (!specDir) return null;
  const root = resolve(specDir);
  const target = join(root, 'operating-origin.json');
  if (!existsSync(target)) return null;
  let origin;
  try {
    const rootStat = lstatSync(root);
    const targetStat = lstatSync(target);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !targetStat.isFile() || targetStat.isSymbolicLink()) {
      fail('Parent SPEC and operating-origin paths must be regular, non-symbolic filesystem entries.');
    }
    const canonicalRoot = realpathSync(root);
    if (realpathSync(dirname(target)) !== canonicalRoot) {
      fail('Parent SPEC operating origin escapes its canonical SPEC directory.');
    }
    origin = JSON.parse(readFileSync(target, 'utf8'));
    assertOperatingOriginV1(origin);
    const expectedDirectory = `${origin.spec.specId}-${origin.spec.slug}`;
    if (resolve(dirname(target)) !== root || basename(root) !== expectedDirectory) {
      fail('Parent SPEC directory and operating-origin SPEC identity do not match exactly.');
    }
    const specPath = join(root, `${expectedDirectory}.md`);
    const specStat = lstatSync(specPath);
    if (!specStat.isFile() || specStat.isSymbolicLink() || realpathSync(dirname(specPath)) !== canonicalRoot) {
      fail('Parent SPEC artifact must be a regular file in its canonical SPEC directory.');
    }
    const specText = readFileSync(specPath, 'utf8');
    const split = splitFrontmatter(specText);
    const frontmatter = split.hasFrontmatter ? parseFrontmatter(split.raw) : null;
    if (frontmatter?.id !== origin.spec.specId || frontmatter?.slug !== origin.spec.slug) {
      fail('Parent SPEC frontmatter identity does not match its operating origin.');
    }
    const contentHash = `sha256:${createHash('sha256').update(specText, 'utf8').digest('hex')}`;
    if (contentHash !== origin.spec.contentHash) {
      fail('Parent SPEC content does not match its operating-origin custody hash.');
    }
  } catch (cause) {
    if (cause instanceof PipelineError && cause.code === 'E_OPERATING_ORIGIN_INVALID') throw cause;
    fail(`Parent SPEC operating origin is not a valid closed contract: ${cause?.code ?? 'invalid JSON'}.`);
  }
  return Object.freeze(structuredClone(origin));
}

export function projectSpecOperatingOrigin(origin) {
  if (origin === null) return null;
  assertOperatingOriginV1(origin);
  return Object.freeze({
    correlationId: origin.correlationId, proposalId: origin.proposalId,
    proposalHash: origin.proposalHash, originHash: origin.originHash,
    specId: origin.spec.specId, decision: structuredClone(origin.decision),
    action: structuredClone(origin.action), metric: structuredClone(origin.metric),
    verification: structuredClone(origin.verification),
    transactionId: origin.transaction.transactionId,
    receiptHash: origin.transaction.receiptHash,
  });
}

export function projectPipelineOperatingOriginCorrelation(origin) {
  if (origin === null) return null;
  return Object.freeze({
    correlation_id: origin.correlationId,
    proposal_id: origin.proposalId,
    proposal_hash: origin.proposalHash,
    transaction_id: origin.transactionId,
    receipt_hash: origin.receiptHash,
  });
}
