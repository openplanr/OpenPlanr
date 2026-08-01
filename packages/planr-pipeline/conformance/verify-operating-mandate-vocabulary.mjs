/**
 * SPEC-004 FR5 — investigation-mandate vocabulary conformance.
 *
 * Proves that every role's requirements are expressed as an investigation mandate
 * a citation can actually satisfy, and that the three previously unsatisfiable
 * claim types (finding 3) no longer exist to fail. Concretely:
 *
 *  (a) Every role's `investigationMandate.examine` is non-empty and its
 *      `sufficientGrounding` is a non-empty string — the mandate is expressible.
 *  (b) Every declared vocabulary term maps to a PRODUCER a mandate-dispatched
 *      agent can cite: a repository path, a git revision, a planr artifact, or a
 *      verified advisor result — never a claim type with no possible producer.
 *  (c) The retired claim types (`user-surface`, `market-signal`,
 *      `operations-evidence`) and the retired `minimumEvidence`/`dispatchMode`
 *      selectors appear nowhere in the registry — the deletion proof.
 *  (d) `createOperatingMandate` produces a schema-valid mandate for every role,
 *      carrying the investigation mandate and no evidence facet.
 *
 * Stdlib + in-repo modules only.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertProtocolArtifact, listOperatingRoles } from '../lib/protocol/contracts.mjs';
import { createOperatingMandate } from '../lib/operate/mandate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const PROTOCOL = '1.3.0';

// The three claim types no collector ever produced (finding 3). They must not
// reappear as investigation vocabulary, since no citation could ever satisfy them.
const RETIRED_CLAIM_TYPES = ['user-surface', 'market-signal', 'operations-evidence'];

// Each producer is something a Protocol v1.3 citation can actually resolve:
// a repository path, a git revision, a planr artifact, or a prior verified
// advisor result. Every declared vocabulary term must name at least one.
const PRODUCERS = [
  {
    name: 'repository path',
    test: /repositor|source|code|config|architect|doc|readme|file|path|markup|route|view|handler|script|surface|onboarding|landing|policy|billing|contract|vendor|integration|marketing|packaging|pricing|payment|security/i,
  },
  { name: 'git revision', test: /git|history|revision|commit|change/i },
  {
    name: 'planr artifact',
    test: /planning|planr|epic|spec|feature|backlog|story|gherkin|outcome|artifact|decision|scope/i,
  },
  { name: 'verified advisor result', test: /advisor result|verified/i },
];

function producersFor(term) {
  return PRODUCERS.filter((producer) => producer.test.test(term)).map(({ name }) => name);
}

const registry = readJson('registry/operating-roles.json');
const registryText = JSON.stringify(registry);

for (const claimType of RETIRED_CLAIM_TYPES) {
  if (registryText.includes(claimType)) {
    throw new Error(
      `The retired, unsatisfiable claim type "${claimType}" reappeared in registry/operating-roles.json; `
      + 'it has no possible citation producer and must not exist.',
    );
  }
}
for (const retired of ['minimumEvidence', 'dispatchMode']) {
  if (registryText.includes(retired)) {
    throw new Error(`The retired "${retired}" selector reappeared in registry/operating-roles.json.`);
  }
}

const roles = listOperatingRoles();
if (roles.length !== 6) {
  throw new Error(`Expected exactly six operating roles; found ${roles.length}.`);
}

for (const role of roles) {
  const mandate = role.investigationMandate;
  if (!mandate || !Array.isArray(mandate.examine) || mandate.examine.length === 0) {
    throw new Error(`Role ${role.id} has no investigation mandate to examine.`);
  }
  if (typeof mandate.sufficientGrounding !== 'string' || mandate.sufficientGrounding.trim().length === 0) {
    throw new Error(`Role ${role.id} declares no sufficient-grounding rule.`);
  }
  for (const term of mandate.examine) {
    const producers = producersFor(term);
    if (producers.length === 0) {
      throw new Error(
        `Role ${role.id} vocabulary term "${term}" maps to no citation producer `
        + '(repository path, git revision, planr artifact, or verified advisor result).',
      );
    }
  }
  if (producersFor(mandate.sufficientGrounding).length === 0) {
    throw new Error(
      `Role ${role.id} sufficient-grounding rule names no citation producer: "${mandate.sufficientGrounding}".`,
    );
  }

  // The builder must produce a schema-valid mandate carrying the investigation
  // mandate and no evidence facet.
  const built = createOperatingMandate(role.id, { roots: ['.planr', 'src', 'lib'] });
  assertProtocolArtifact('operating-mandate', built, { protocolVersion: PROTOCOL });
  if ('evidence' in built || 'evidenceIndex' in built) {
    throw new Error(`The generated mandate for ${role.id} leaked an evidence facet.`);
  }
  if (built.investigationMandate.sufficientGrounding !== mandate.sufficientGrounding) {
    throw new Error(`The generated mandate for ${role.id} drifted from the canonical investigation mandate.`);
  }
}

// The static fixture is a valid mandate with no evidence property.
const fixture = readJson('conformance/fixtures/operating-board/mandate-valid.json');
assertProtocolArtifact('operating-mandate', fixture, { protocolVersion: PROTOCOL });
if ('evidence' in fixture || 'evidenceIndex' in fixture) {
  throw new Error('The mandate-valid fixture carries an evidence facet; the mandate must carry none.');
}

process.stdout.write(
  `Operating mandate vocabulary conformance passed (${roles.length} roles: every investigation `
  + 'mandate is expressible, every vocabulary term names a citation producer, and the three '
  + 'unsatisfiable claim types plus minimumEvidence/dispatchMode are gone).\n',
);
