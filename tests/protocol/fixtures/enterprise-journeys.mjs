import { canonicalizeJson, sha256Hex } from '../../../packages/protocol/src/canonical-json.mjs';
import {
  assertCompanyResourceCommitReceipt,
  assertCompanyResourcePreparationRetry,
  assertEnterpriseFixedGuestAccess,
  assertEnterpriseGuestAuthorizationReceipt,
  assertEnterpriseJourneyContract,
  assertEnterpriseJourneyWrite,
  assertEnterpriseMentionRecipients,
  assertEnterpriseProjectTransition,
  enterprisePageQueryDigest,
  enterpriseProjectAdmission,
} from '../../../packages/protocol/src/enterprise-journey-contracts.mjs';
import { assertLargeObjectContract } from '../../../packages/protocol/src/large-object-contracts.mjs';

export function journeyFixtures() {
  const now = '2026-10-07T12:00:00.000Z',
    later = '2026-10-08T12:00:00.000Z';
  const hash = 'a'.repeat(64),
    operationId = 'o'.repeat(22),
    revisionId = 'r'.repeat(22);
  const scope = { organizationId: 'org_test', projectId: 'project_test' };
  const artifact = { ...scope, artifactId: 'artifact_test' };
  const envelope = (kind) => ({
    kind: `openplanr-${kind}`,
    schemaVersion: '1.0.0',
    protocolVersion: '1.19.0',
  });
  const pin = {
    revisionId,
    publicationId: 'publication_original',
    contentDigest: `sha256:${hash}`,
  };
  const authorization = {
    ...envelope('enterprise-guest-authorization'),
    ...artifact,
    authorizationId: 'authorization_test',
    operationId,
    invitationId: 'invitation_test',
    actorId: 'guest_test',
    role: 'reviewer',
    binding: 'fixed',
    pin,
    status: 'active',
    lifecycleEpoch: 1,
    expiresAt: later,
    receipt: {
      receiptId: 'receipt_test',
      operationId,
      authorizedAt: now,
      publicationHeadAdvanced: false,
    },
  };
  const invitation = {
    ...envelope('enterprise-guest-invitation'),
    ...artifact,
    invitationId: 'invitation_test',
    deliveryOperationId: operationId,
    inviterId: 'author_test',
    recipientId: 'guest_test',
    role: 'reviewer',
    binding: 'fixed',
    pin,
    deliveryStatus: 'delivered',
    grantStatus: 'pending',
    createdAt: now,
    expiresAt: later,
  };
  const requested = { ...artifact, ...pin, actorId: 'guest_test', lifecycleEpoch: 1 };
  const query = {
    ...scope,
    actorId: 'author_test',
    scope: 'artifacts',
    filter: { kind: 'all', status: 'active', search: '' },
  };
  const page = {
    ...envelope('enterprise-artifact-page'),
    query,
    items: [
      {
        ...artifact,
        kind: 'artifact',
        contentFormat: 'planning-document',
        title: 'Release plan',
        revisionId,
        status: 'active',
        capabilities: ['artifact.read'],
      },
    ],
    nextCursor: { token: 'opaque-signed-token', queryDigest: enterprisePageQueryDigest(query) },
  };
  const projectQuery = {
    organizationId: scope.organizationId,
    actorId: 'author_test',
    scope: 'projects',
    filter: { status: 'all', search: '' },
  };
  const projects = {
    ...envelope('enterprise-project-page'),
    query: projectQuery,
    items: [
      { ...scope, name: 'Engineering', slug: 'engineering', status: 'active', capabilities: [] },
    ],
    nextCursor: null,
  };
  const reviews = {
    ...envelope('enterprise-review-projection'),
    query: {
      organizationId: scope.organizationId,
      actorId: 'author_test',
      scope: 'organization-reviews',
      filter: query.filter,
    },
    items: [
      {
        ...artifact,
        threadId: 'thread_test',
        revisionId,
        publicationId: 'publication_original',
        category: 'question',
        status: 'open',
        updatedAt: now,
      },
    ],
    nextCursor: null,
    index: { status: 'lagging', watermark: now },
  };
  const mention = {
    ...envelope('enterprise-review-mention'),
    ...artifact,
    operationId,
    actorId: 'author_test',
    threadId: 'thread_test',
    anchor: { revisionId, elementId: 'node:start' },
    recipients: ['guest_test'],
    authority: 'notification-only',
  };
  const eligible = {
    ...artifact,
    actorId: 'author_test',
    revisionId,
    recipientIds: ['guest_test'],
  };
  const active = {
    ...envelope('enterprise-project-lifecycle'),
    ...scope,
    status: 'active',
    version: 0,
    epoch: 1,
    updatedAt: now,
  };
  const archiving = {
    ...active,
    status: 'archiving',
    version: 1,
    epoch: 2,
    operation: {
      operationId,
      action: 'archive',
      expectedVersion: 0,
      previousEpoch: 1,
      inventoryDigest: `sha256:${hash}`,
      artifactCount: 20001,
      acknowledgedCount: 0,
      acknowledgedInventoryDigest: null,
    },
  };
  const archived = {
    ...archiving,
    status: 'archived',
    version: 2,
    operation: {
      ...archiving.operation,
      acknowledgedCount: 20001,
      acknowledgedInventoryDigest: `sha256:${hash}`,
    },
    receipt: {
      receiptId: 'lifecycle_receipt',
      operationId,
      action: 'archive',
      version: 2,
      epoch: 2,
      completedAt: now,
    },
  };
  const transition = {
    ...envelope('enterprise-project-transition'),
    ...scope,
    operationId,
    actorId: 'author_test',
    action: 'archive',
    expectedVersion: 0,
    expectedEpoch: 1,
  };
  const capabilities = {
    ...envelope('enterprise-journey-capabilities'),
    readers: ['resource-draft', 'fixed-guest', 'project-lifecycle'],
    writers: ['resource-draft'],
    rollbackFloor: {
      protocolVersion: '1.19.0',
      serviceVersion: 'reviewed-candidate',
      candidateDigest: `sha256:${hash}`,
    },
  };
  const manifest = {
    schemaVersion: '2.0.0',
    kind: 'openplanr-company-resource-manifest',
    ...artifact,
    revisionId,
    contentDigest: `sha256:${hash}`,
    contentType: 'application/json',
    byteLength: 10,
    decodedBytes: 10,
    catalog: { offset: 0, encodedBytes: 10, decodedBytes: 10, codec: 'identity' },
    chunks: [{ index: 0, byteLength: 10, sha256: hash }],
  };
  const legacy = { schemaVersion: '2.0.0', operationId, baseRevisionId: null, manifest };
  const preparation = {
    ...legacy,
    schemaVersion: '2.1.0',
    protocolVersion: '1.19.0',
    intent: 'draft',
    expectedVersion: 0,
    lifecycleEpoch: 1,
  };
  const receipt = {
    schemaVersion: '2.1.0',
    protocolVersion: '1.19.0',
    ...artifact,
    operationId,
    revisionId,
    manifestSha256: sha256Hex(canonicalizeJson(manifest)),
    contentDigest: manifest.contentDigest,
    status: 'committed',
    committedAt: now,
    baseRevisionId: null,
    version: 1,
    lifecycleEpoch: 1,
    intent: 'draft',
    effect: { kind: 'draft', authorHeadRevisionId: revisionId, publicationHeadUnchanged: true },
  };
  const status = {
    schemaVersion: '2.1.0',
    protocolVersion: '1.19.0',
    operationId,
    revisionId,
    manifestSha256: receipt.manifestSha256,
    intent: 'draft',
    lifecycleEpoch: 1,
    expiresAt: later,
    status: 'committed',
    receivedChunks: manifest.chunks,
    receipt,
  };
  return {
    now,
    later,
    envelope,
    invitation,
    authorization,
    requested,
    query,
    page,
    projects,
    reviews,
    mention,
    eligible,
    active,
    archiving,
    archived,
    transition,
    capabilities,
    legacy,
    preparation,
    receipt,
    status,
  };
}
export function enterpriseJourneyProof() {
  const f = journeyFixtures();
  const cases = [];
  const check = (name, action, rejects = false) => {
    let failed = false;
    try {
      action();
    } catch {
      failed = true;
    }
    cases.push({ name, passed: failed === rejects });
  };
  const invalid = (name, value, kind, edit) => {
    const copy = structuredClone(value);
    edit(copy);
    check(name, () => assertEnterpriseJourneyContract(copy, kind), true);
  };
  for (const [key, kind] of [
    ['invitation', 'enterprise-guest-invitation'],
    ['authorization', 'enterprise-guest-authorization'],
    ['page', 'enterprise-artifact-page'],
    ['projects', 'enterprise-project-page'],
    ['reviews', 'enterprise-review-projection'],
    ['mention', 'enterprise-review-mention'],
    ['active', 'enterprise-project-lifecycle'],
    ['archiving', 'enterprise-project-lifecycle'],
    ['archived', 'enterprise-project-lifecycle'],
    ['transition', 'enterprise-project-transition'],
    ['capabilities', 'enterprise-journey-capabilities'],
    ['preparation', 'company-resource-upload-prepare'],
    ['receipt', 'company-resource-upload-receipt'],
    ['status', 'company-resource-upload-status'],
  ])
    check(`valid ${key}`, () => assertEnterpriseJourneyContract(f[key], kind));
  check('legacy prepare still readable', () =>
    assertLargeObjectContract(f.legacy, 'company-resource-upload-prepare'),
  );
  for (const expiresAt of [
    '2026-99-99T99:99:99Z',
    '2026-02-30T12:00:00Z',
    '2026-10-08T12:00:00+02:00',
  ]) {
    check(
      `invalid expiry ${expiresAt}`,
      () => assertEnterpriseFixedGuestAccess({ ...f.authorization, expiresAt }, f.requested, f.now),
      true,
    );
    check(
      `invalid invitation calendar ${expiresAt}`,
      () =>
        assertEnterpriseJourneyContract(
          { ...f.invitation, expiresAt },
          'enterprise-guest-invitation',
        ),
      true,
    );
  }
  check('acceptance preserves original snapshot', () =>
    assertEnterpriseGuestAuthorizationReceipt(f.authorization, f.invitation, f.now),
  );
  check(
    'acceptance cannot extend expiry',
    () =>
      assertEnterpriseGuestAuthorizationReceipt(
        { ...f.authorization, expiresAt: '2026-10-09T12:00:00.000Z' },
        f.invitation,
        f.now,
      ),
    true,
  );
  check(
    'revoked invitation cannot activate',
    () =>
      assertEnterpriseGuestAuthorizationReceipt(
        f.authorization,
        { ...f.invitation, grantStatus: 'revoked' },
        f.now,
      ),
    true,
  );
  check('fixed pin exact access', () =>
    assertEnterpriseFixedGuestAccess(f.authorization, f.requested, f.now),
  );
  check(
    'fixed pin never follows new head',
    () =>
      assertEnterpriseFixedGuestAccess(
        f.authorization,
        { ...f.requested, revisionId: 's'.repeat(22) },
        f.now,
      ),
    true,
  );
  check(
    'pin expires authoritatively',
    () => assertEnterpriseFixedGuestAccess(f.authorization, f.requested, f.later),
    true,
  );
  check(
    'stale lease epoch denied',
    () =>
      assertEnterpriseFixedGuestAccess(
        f.authorization,
        { ...f.requested, lifecycleEpoch: 2 },
        f.now,
      ),
    true,
  );
  invalid(
    'authorization does not move publication',
    f.authorization,
    'enterprise-guest-authorization',
    (x) => {
      x.receipt.publicationHeadAdvanced = true;
    },
  );
  invalid(
    'pending cannot carry active receipt',
    f.authorization,
    'enterprise-guest-authorization',
    (x) => {
      x.status = 'pending';
    },
  );
  check('revoked grant retains its historical receipt', () =>
    assertEnterpriseJourneyContract(
      { ...f.authorization, status: 'revoked' },
      'enterprise-guest-authorization',
    ),
  );
  check(
    'revoked fixed grant denies access',
    () =>
      assertEnterpriseFixedGuestAccess(
        { ...f.authorization, status: 'revoked' },
        f.requested,
        f.now,
      ),
    true,
  );
  invalid(
    'fixed cannot become following',
    f.authorization,
    'enterprise-guest-authorization',
    (x) => {
      x.binding = 'following';
    },
  );
  invalid('cursor actor bound', f.page, 'enterprise-artifact-page', (x) => {
    x.query.actorId = 'other_actor';
  });
  check('existing project slug writer bounds remain readable', () => {
    for (const slug of ['project_000', '_legacy--project', 'a'.repeat(150)]) {
      const page = structuredClone(f.projects);
      page.items[0].slug = slug;
      assertEnterpriseJourneyContract(page, 'enterprise-project-page');
    }
  });
  for (const slug of ['project/path', 'a'.repeat(151), 'project\n']) {
    invalid(
      `unsafe or oversized slug denied ${slug.length}`,
      f.projects,
      'enterprise-project-page',
      (x) => {
        x.items[0].slug = slug;
      },
    );
  }
  invalid('cursor filters bound', f.page, 'enterprise-artifact-page', (x) => {
    x.query.filter.search = 'new query';
  });
  invalid('cursor content format bound', f.page, 'enterprise-artifact-page', (x) => {
    x.query.filter.contentFormat = 'planning-document';
  });
  invalid('unknown content format denied', f.page, 'enterprise-artifact-page', (x) => {
    x.query.filter.contentFormat = 'handoff';
    x.nextCursor = null;
  });
  check('Plan filter is declared and cursor bound', () => {
    const page = structuredClone(f.page);
    page.query.filter.contentFormat = 'planning-document';
    page.nextCursor.queryDigest = enterprisePageQueryDigest(page.query);
    assertEnterpriseJourneyContract(page, 'enterprise-artifact-page');
  });
  check('empty artifact has no invented revision', () => {
    const page = structuredClone(f.page);
    page.items[0].revisionId = null;
    page.items[0].capabilities = ['artifact.author'];
    assertEnterpriseJourneyContract(page, 'enterprise-artifact-page');
  });
  invalid('empty revision sentinel denied', f.page, 'enterprise-artifact-page', (x) => {
    x.items[0].revisionId = '';
  });
  invalid('cross-project row denied', f.page, 'enterprise-artifact-page', (x) => {
    x.items[0].projectId = 'other_project';
  });
  invalid('handoff is not artifact kind', f.page, 'enterprise-artifact-page', (x) => {
    x.items[0].kind = 'handoff';
  });
  invalid(
    'Plan is planning content not new artifact kind',
    f.page,
    'enterprise-artifact-page',
    (x) => {
      x.items[0].kind = 'plan';
    },
  );
  invalid('diagram format is explicit', f.page, 'enterprise-artifact-page', (x) => {
    x.items[0].kind = 'diagram';
  });
  check('authorized mention', () => assertEnterpriseMentionRecipients(f.mention, f.eligible));
  check(
    'unknown mention identity denied',
    () => assertEnterpriseMentionRecipients(f.mention, { ...f.eligible, recipientIds: [] }),
    true,
  );
  check(
    'mention cannot relocate revision',
    () =>
      assertEnterpriseMentionRecipients(f.mention, { ...f.eligible, revisionId: 'wrong_revision' }),
    true,
  );
  check('active epoch admitted', () => {
    if (!enterpriseProjectAdmission(f.active, 1)) throw Error();
  });
  check('archive fence denies content', () => {
    if (enterpriseProjectAdmission(f.archiving, 2)) throw Error();
  });
  invalid('archive waits for every barrier', f.archived, 'enterprise-project-lifecycle', (x) => {
    x.operation.acknowledgedCount -= 1;
  });
  invalid('archive rejects wrong inventory', f.archived, 'enterprise-project-lifecycle', (x) => {
    x.operation.acknowledgedInventoryDigest = `sha256:${'b'.repeat(64)}`;
  });
  const restoring = {
    ...f.archived,
    status: 'restoring',
    version: 3,
    epoch: 3,
    operation: {
      ...f.archived.operation,
      action: 'restore',
      expectedVersion: 2,
      previousEpoch: 2,
      acknowledgedCount: 0,
      acknowledgedInventoryDigest: null,
    },
  };
  delete restoring.receipt;
  check('restore denies old lease', () => {
    assertEnterpriseJourneyContract(restoring, 'enterprise-project-lifecycle');
    if (enterpriseProjectAdmission(restoring, 2)) throw Error();
  });
  const restored = {
    ...restoring,
    status: 'active',
    version: 4,
    operation: {
      ...restoring.operation,
      acknowledgedCount: restoring.operation.artifactCount,
      acknowledgedInventoryDigest: restoring.operation.inventoryDigest,
    },
    receipt: { ...f.archived.receipt, action: 'restore', epoch: 3, version: 4 },
  };
  check('restored project requires new epoch', () => {
    assertEnterpriseJourneyContract(restored, 'enterprise-project-lifecycle');
    if (enterpriseProjectAdmission(restored, 2) || !enterpriseProjectAdmission(restored, 3))
      throw Error();
  });
  check('transition CAS basis', () => assertEnterpriseProjectTransition(f.transition, f.active));
  check(
    'transition race denied',
    () => assertEnterpriseProjectTransition(f.transition, { ...f.active, version: 1 }),
    true,
  );
  check('reader first draft enabled', () =>
    assertEnterpriseJourneyWrite(f.capabilities, 'resource-draft'),
  );
  check(
    'unsupported publish denied before bytes',
    () => assertEnterpriseJourneyWrite(f.capabilities, 'resource-publication'),
    true,
  );
  invalid(
    'writer without reader denied',
    f.capabilities,
    'enterprise-journey-capabilities',
    (x) => {
      x.readers = [];
    },
  );
  check('exact preparation retry', () =>
    assertCompanyResourcePreparationRetry(f.preparation, structuredClone(f.preparation)),
  );
  check(
    'intent cannot change on retry',
    () =>
      assertCompanyResourcePreparationRetry(f.preparation, { ...f.preparation, intent: 'publish' }),
    true,
  );
  check('exact draft receipt', () => assertCompanyResourceCommitReceipt(f.receipt, f.preparation));
  check(
    'receipt binds expected head version',
    () => assertCompanyResourceCommitReceipt(f.receipt, { ...f.preparation, expectedVersion: 1 }),
    true,
  );
  invalid('draft never returns publication', f.receipt, 'company-resource-upload-receipt', (x) => {
    x.effect = {
      kind: 'publication',
      authorHeadRevisionId: x.revisionId,
      publicationId: 'publication_new',
      publicationRevisionId: x.revisionId,
    };
  });
  invalid('status identity binds intent', f.status, 'company-resource-upload-status', (x) => {
    x.intent = 'publish';
  });
  invalid('committed status requires receipt', f.status, 'company-resource-upload-status', (x) => {
    delete x.receipt;
  });
  invalid('cancel is terminal', f.status, 'company-resource-upload-status', (x) => {
    x.status = 'cancelled';
  });
  check(
    'expired status retains deadline without receipt',
    () =>
      assertEnterpriseJourneyContract(
        { ...f.status, status: 'expired', receipt: undefined },
        'company-resource-upload-status',
      ),
    true,
  );
  const expired = structuredClone(f.status);
  delete expired.receipt;
  expired.status = 'expired';
  check('expired tombstone is readable', () =>
    assertEnterpriseJourneyContract(expired, 'company-resource-upload-status'),
  );
  check('accessors never execute', () => {
    let called = false,
      rejected = false;
    const value = {};
    Object.defineProperty(value, 'protocolVersion', {
      enumerable: true,
      get() {
        called = true;
        return '1.19.0';
      },
    });
    try {
      assertEnterpriseJourneyContract(value, 'company-resource-upload-prepare');
    } catch {
      rejected = true;
    }
    if (called || !rejected) throw Error('A hostile accessor was evaluated or accepted.');
  });
  return { cases };
}
