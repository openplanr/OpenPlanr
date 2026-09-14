import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_PRODUCT_STATE_KINDS,
  type DashboardProductStateKind,
  dashboardProductStatePolicy,
  parseDashboardProductState,
  parseDashboardProductStateJson,
  productStateAllowsMutation,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  DASHBOARD_SAFE_CONTEXT_FIELDS,
  DASHBOARD_SAFE_ERROR_CODES,
  DASHBOARD_SAFE_ERROR_FALLBACK,
  dashboardErrorRecoveryPolicy,
  mapDashboardSafeError,
  parseDashboardSafeError,
  parseDashboardSafeErrorJson,
} from '../../../../apps/dashboard/src/lib/api/safe-errors.js';
import {
  DashboardValidationError,
  parseExactJson,
} from '../../../../apps/dashboard/src/lib/api/validation.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const HASH = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const CERTIFIED_HYPHENATED_OPERATIONS = Object.freeze([
  'operate.planning.create-spec',
  'operate.planning.ingest-delivery',
  'operate.recovery.clear-stale-lock',
]);
const binding = createDashboardQueryIdentity({
  productArea: 'operate',
  route: '#/operate/today',
  actorId: 'owner-acme',
  projectId: HASH('a'),
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  cycleId: 'cycle-current',
  subjectId: null,
  eventHead: { sequence: 46, hash: HASH('b') },
  viewHash: HASH('c'),
  generation: 7,
});

const DATA_KINDS = new Set<DashboardProductStateKind>([
  'ready',
  'read-only',
  'refreshing',
  'stale',
  'degraded',
  'blocked',
  'partial',
  'uncertain',
  'recovering',
]);
const NO_BINDING_KINDS = new Set<DashboardProductStateKind>([
  'booting',
  'unauthorized',
  'incompatible',
  'corrupt',
]);
const REQUIRED_ERROR_KINDS = new Set<DashboardProductStateKind>([
  'unauthorized',
  'incompatible',
  'corrupt',
  'conflict',
  'uncertain',
]);
const PRODUCT_ERROR_MATRIX: Record<DashboardProductStateKind, readonly string[]> = {
  booting: [],
  loading: [],
  'first-use': [],
  ready: [],
  empty: [],
  'read-only': [],
  refreshing: [],
  stale: ['DASHBOARD_STALE_RESPONSE', 'DASHBOARD_READ_FAILED'],
  degraded: ['DASHBOARD_ERROR_UNAVAILABLE', 'DASHBOARD_READ_FAILED'],
  blocked: [],
  unavailable: ['DASHBOARD_ERROR_UNAVAILABLE', 'DASHBOARD_READ_FAILED'],
  unauthorized: ['CAPABILITY_DENIED'],
  offline: ['DASHBOARD_ERROR_UNAVAILABLE', 'DASHBOARD_READ_FAILED'],
  incompatible: [
    'DASHBOARD_BUILD_MISMATCH',
    'DASHBOARD_ASSET_MISSING',
    'DASHBOARD_MANIFEST_MISSING',
  ],
  corrupt: [
    'DASHBOARD_RESPONSE_INVALID',
    'DASHBOARD_MANIFEST_INVALID',
    'DASHBOARD_BOOTSTRAP_INVALID',
  ],
  conflict: ['CONCURRENT_MODIFICATION', 'OPERATION_CONFLICT'],
  partial: ['DASHBOARD_READ_FAILED'],
  uncertain: ['OPERATION_UNCERTAIN'],
  recovering: [],
};

function safeError(kind: DashboardProductStateKind) {
  const codes: Partial<Record<DashboardProductStateKind, string>> = {
    unauthorized: 'CAPABILITY_DENIED',
    incompatible: 'DASHBOARD_BUILD_MISMATCH',
    corrupt: 'DASHBOARD_RESPONSE_INVALID',
    conflict: 'CONCURRENT_MODIFICATION',
    uncertain: 'OPERATION_UNCERTAIN',
  };
  const code = codes[kind];
  return code ? { code, retryable: kind === 'conflict', context: {} } : null;
}

function state(kind: DashboardProductStateKind) {
  return {
    kind,
    binding: NO_BINDING_KINDS.has(kind) ? null : binding,
    data:
      DATA_KINDS.has(kind) || kind === 'offline'
        ? { marker: `validated-${kind}`, eventSequence: 46 }
        : null,
    reasonCodes: ['booting', 'loading', 'ready'].includes(kind)
      ? []
      : [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
    error: safeError(kind),
    mutationEnabled: kind === 'ready',
    policy: dashboardProductStatePolicy(kind),
  };
}

const options = {
  currentBinding: binding,
  validateData: (value: unknown): value is { marker: string; eventSequence: number } =>
    !!value &&
    typeof value === 'object' &&
    typeof (value as { marker?: unknown }).marker === 'string' &&
    (value as { eventSequence?: unknown }).eventSequence === 46,
};

describe('closed dashboard product-state model', () => {
  it('owns exactly the 19 SPEC-020 taxonomy tags with deterministic policy', () => {
    expect(DASHBOARD_PRODUCT_STATE_KINDS).toEqual([
      'booting',
      'loading',
      'first-use',
      'ready',
      'empty',
      'read-only',
      'refreshing',
      'stale',
      'degraded',
      'blocked',
      'unavailable',
      'unauthorized',
      'offline',
      'incompatible',
      'corrupt',
      'conflict',
      'partial',
      'uncertain',
      'recovering',
    ]);
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      const parsed = parseDashboardProductState(state(kind), options);
      expect(parsed.kind).toBe(kind);
      expect(parsed.policy.state).toBe(kind);
      expect(parsed.policy.blindRetry).toBe(false);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.policy)).toBe(true);
      expect(parsed.mutationEnabled).toBe(kind === 'ready');
    }
  });

  it('rejects every cross-state tagged payload substitution', () => {
    for (const sourceKind of DASHBOARD_PRODUCT_STATE_KINDS) {
      for (const targetKind of DASHBOARD_PRODUCT_STATE_KINDS) {
        if (sourceKind === targetKind) continue;
        expect(
          () => parseDashboardProductState({ ...state(sourceKind), kind: targetKind }, options),
          `${sourceKind} payload must not enter ${targetKind}`,
        ).toThrow(DashboardValidationError);
      }
    }
  });

  it('default-denies mutation for every non-ready tag and rechecks exact current ready custody', () => {
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      if (kind === 'ready') continue;
      expect(() =>
        parseDashboardProductState({ ...state(kind), mutationEnabled: true }, options),
      ).toThrow('default-denied');
    }
    const ready = parseDashboardProductState(state('ready'), options);
    expect(productStateAllowsMutation(ready, binding)).toBe(true);
    expect(productStateAllowsMutation(ready, { ...binding, generation: 8 })).toBe(false);
    expect(() =>
      parseDashboardProductState(state('ready'), { validateData: options.validateData }),
    ).toThrow('explicitly supplied non-null exact current binding');
  });

  it('requires explicit exact current custody for every bound tag before any data validation', () => {
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      if (NO_BINDING_KINDS.has(kind)) continue;
      const validationCalls = vi.fn();
      const validateData = (value: unknown): value is { marker: string; eventSequence: number } => {
        validationCalls(value);
        return options.validateData(value);
      };
      expect(
        () => parseDashboardProductState(state(kind), { validateData }),
        `${kind} must not expose state without current custody`,
      ).toThrow('explicitly supplied non-null exact current binding');
      expect(validationCalls, `${kind} must fail before data access`).not.toHaveBeenCalled();
    }

    for (const kind of NO_BINDING_KINDS) {
      expect(parseDashboardProductState(state(kind)).kind).toBe(kind);
    }
    expect(
      parseDashboardProductState({ ...state('offline'), binding: null, data: null }).data,
    ).toBeNull();
  });

  it('brands only parsed ready states and fails hostile current-binding input closed', () => {
    const parsed = parseDashboardProductState(state('ready'), options);
    expect(productStateAllowsMutation(parsed, binding)).toBe(true);
    expect(productStateAllowsMutation({ ...parsed }, binding)).toBe(false);

    const extraCurrent = { ...binding, privateMarker: 'private-current-binding' };
    expect(productStateAllowsMutation(parsed, extraCurrent as unknown as typeof binding)).toBe(
      false,
    );

    let getCalls = 0;
    const hostileCurrent = new Proxy(binding, {
      get() {
        getCalls += 1;
        throw new Error('private-current-binding');
      },
    });
    expect(productStateAllowsMutation(parsed, hostileCurrent)).toBe(false);
    expect(getCalls).toBe(0);

    const validationCalls = vi.fn();
    const validateData = (value: unknown): value is { marker: string; eventSequence: number } => {
      validationCalls(value);
      return options.validateData(value);
    };
    try {
      parseDashboardProductState(state('ready'), {
        currentBinding: extraCurrent as unknown as typeof binding,
        validateData,
      });
      expect.fail('hostile current binding must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardValidationError);
      expect(String(error)).not.toContain('private-current-binding');
    }
    expect(validationCalls).not.toHaveBeenCalled();

    try {
      parseDashboardProductState(state('ready'), {
        currentBinding: hostileCurrent,
        validateData,
      });
      expect.fail('proxy current binding must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardValidationError);
      expect(String(error)).not.toContain('private-current-binding');
    }
    expect(getCalls).toBe(0);
    expect(validationCalls).not.toHaveBeenCalled();
  });

  it('accepts a validated large-project projection within the Planning wire budget', () => {
    const records = Array.from({ length: 1_600 }, (_, index) => ({
      id: `BL-${String(index + 1).padStart(4, '0')}`,
      title: `Planning record ${index + 1}`,
      frontmatter: {
        owner: 'Engineering',
        tags: ['dashboard', 'planning', 'enterprise'],
        evidence: { status: 'verified', sequence: index + 1 },
      },
    }));
    const data = { marker: 'validated-large-project', eventSequence: 46, records };
    const parsed = parseDashboardProductState(
      { ...state('ready'), data },
      {
        currentBinding: binding,
        validateData: (value: unknown): value is typeof data =>
          !!value &&
          typeof value === 'object' &&
          (value as { marker?: unknown }).marker === 'validated-large-project' &&
          (value as { eventSequence?: unknown }).eventSequence === 46 &&
          Array.isArray((value as { records?: unknown }).records) &&
          (value as { records: unknown[] }).records.length === 1_600,
      },
    );

    expect(parsed.kind).toBe('ready');
    expect(parsed.data?.records).toHaveLength(1_600);
    expect(productStateAllowsMutation(parsed, binding)).toBe(true);
  });

  it.each([
    [
      'productArea',
      createDashboardQueryIdentity({
        ...binding,
        productArea: 'planning',
        route: '#/overview',
        subjectId: null,
      }),
    ],
    [
      'route',
      createDashboardQueryIdentity({
        ...binding,
        route: '#/operate/actions/foreign-action',
        subjectId: 'foreign-action',
      }),
    ],
    [
      'subjectId',
      createDashboardQueryIdentity({
        ...binding,
        route: '#/operate/evidence/foreign-evidence',
        subjectId: 'foreign-evidence',
      }),
    ],
    ['actorId', 'foreign-owner'],
    ['projectId', HASH('d')],
    ['scopeId', 'foreign-scope'],
    ['domainId', 'software'],
    ['domainVersion', '2.0.0'],
    ['cycleId', 'foreign-cycle'],
    ['eventHead', { sequence: 47, hash: HASH('d') }],
    ['viewHash', HASH('d')],
    ['generation', 8],
  ])('rejects stale or foreign %s custody before data access', (field, replacement) => {
    const hostile =
      typeof replacement === 'object' && replacement !== null && 'productArea' in replacement
        ? replacement
        : createDashboardQueryIdentity({ ...binding, [field]: replacement });
    const validationCalls = vi.fn();
    expect(() =>
      parseDashboardProductState(
        { ...state('stale'), binding: hostile },
        {
          currentBinding: binding,
          validateData: (value: unknown): value is { marker: string; eventSequence: number } => {
            validationCalls(value);
            return options.validateData(value);
          },
        },
      ),
    ).toThrow('explicitly supplied non-null exact current binding');
    expect(validationCalls).not.toHaveBeenCalled();
  });

  it('retains offline data only with the exact same validated binding', () => {
    const retained = parseDashboardProductState(state('offline'), options);
    expect(retained.data).toMatchObject({ marker: 'validated-offline' });
    expect(retained.mutationEnabled).toBe(false);
    expect(
      parseDashboardProductState(
        { ...state('offline'), binding: null, data: null },
        { currentBinding: binding },
      ).data,
    ).toBeNull();
    expect(() =>
      parseDashboardProductState({ ...state('offline'), binding: null }, options),
    ).toThrow('offline cache requires its exact binding');
    expect(() =>
      parseDashboardProductState(
        { ...state('offline'), binding: { ...binding, actorId: 'foreign-owner' } },
        options,
      ),
    ).toThrow('explicitly supplied non-null exact current binding');
  });

  it('keeps ready, stale, partial, conflict, uncertain, incompatible, and corrupt semantics distinct', () => {
    for (const kind of [
      'stale',
      'partial',
      'conflict',
      'uncertain',
      'incompatible',
      'corrupt',
    ] as const) {
      const parsed = parseDashboardProductState(state(kind), options);
      expect(parsed.kind).toBe(kind);
      expect(parsed.mutationEnabled).toBe(false);
      expect(parsed.policy.recovery).not.toBe('none');
    }
    for (const [kind, code] of [
      ['uncertain', 'CONCURRENT_MODIFICATION'],
      ['conflict', 'OPERATION_UNCERTAIN'],
      ['incompatible', 'CAPABILITY_DENIED'],
      ['corrupt', 'DASHBOARD_BUILD_MISMATCH'],
      ['unauthorized', 'OPERATION_UNCERTAIN'],
    ] as const) {
      expect(() =>
        parseDashboardProductState(
          { ...state(kind), error: { code, retryable: false, context: {} } },
          options,
        ),
      ).toThrow('does not match the tagged product state');
    }
  });

  it('enforces the complete 19-tag by finite-safe-code and null applicability matrix', () => {
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      const allowed = new Set(PRODUCT_ERROR_MATRIX[kind]);
      for (const code of DASHBOARD_SAFE_ERROR_CODES) {
        const candidate = {
          ...state(kind),
          error: { code, retryable: false, context: {} },
        };
        if (allowed.has(code)) {
          expect(
            parseDashboardProductState(candidate, options).error?.code,
            `${kind}/${code}`,
          ).toBe(code);
        } else {
          expect(
            () => parseDashboardProductState(candidate, options),
            `${kind}/${code} must be rejected`,
          ).toThrow(DashboardValidationError);
        }
      }
      const withoutError = { ...state(kind), error: null };
      if (REQUIRED_ERROR_KINDS.has(kind)) {
        expect(() => parseDashboardProductState(withoutError, options), `${kind}/null`).toThrow(
          'required for this product state',
        );
      } else {
        expect(parseDashboardProductState(withoutError, options).error, `${kind}/null`).toBeNull();
      }
    }
  });

  it('reconciles every owner-bound error identity to exact binding custody', () => {
    const subjectBinding = createDashboardQueryIdentity({
      ...binding,
      route: '#/operate/actions/action-current',
      subjectId: 'action-current',
    });
    const subjectOptions = { ...options, currentBinding: subjectBinding };
    const exactContext = {
      cycleId: 'cycle-current',
      assignmentId: 'action-current',
      submissionId: 'action-current',
      reviewId: 'action-current',
    };
    const candidate = {
      ...state('conflict'),
      binding: subjectBinding,
      error: { code: 'CONCURRENT_MODIFICATION', retryable: false, context: exactContext },
    };
    expect(parseDashboardProductState(candidate, subjectOptions).error?.context).toEqual(
      exactContext,
    );
    for (const field of ['cycleId', 'assignmentId', 'submissionId', 'reviewId'] as const) {
      expect(() =>
        parseDashboardProductState(
          {
            ...candidate,
            error: {
              ...candidate.error,
              context: { ...exactContext, [field]: 'foreign-identity' },
            },
          },
          subjectOptions,
        ),
      ).toThrow('does not match exact custody');
    }
    expect(() =>
      parseDashboardProductState(
        {
          ...state('conflict'),
          error: {
            code: 'CONCURRENT_MODIFICATION',
            retryable: false,
            context: { assignmentId: 'action-current' },
          },
        },
        options,
      ),
    ).toThrow('does not match exact custody');

    const noCycleBinding = createDashboardQueryIdentity({ ...binding, cycleId: null });
    expect(() =>
      parseDashboardProductState(
        {
          ...state('conflict'),
          binding: noCycleBinding,
          error: {
            code: 'CONCURRENT_MODIFICATION',
            retryable: false,
            context: { cycleId: 'cycle-current' },
          },
        },
        { ...options, currentBinding: noCycleBinding },
      ),
    ).toThrow('does not match exact custody');
  });

  it('forbids owner-bound safe context in unbound privacy states', () => {
    for (const kind of ['unauthorized', 'incompatible', 'corrupt'] as const) {
      const candidate = state(kind);
      expect(() =>
        parseDashboardProductState(
          {
            ...candidate,
            error: {
              ...candidate.error,
              context: { cycleId: 'private-cycle-token' },
            },
          },
          options,
        ),
      ).toThrow('must not disclose owner-bound identifiers');
    }
  });

  it('forbids reason/error/data substitutions in booting, loading, and ready', () => {
    for (const kind of ['booting', 'loading', 'ready'] as const) {
      expect(() =>
        parseDashboardProductState(
          { ...state(kind), reasonCodes: ['OPERATE_PROJECTION_STALE'] },
          options,
        ),
      ).toThrow('not valid for this product state');
      expect(() =>
        parseDashboardProductState(
          {
            ...state(kind),
            error: { code: 'OPERATION_UNCERTAIN', retryable: false, context: {} },
          },
          options,
        ),
      ).toThrow('not valid for this product state');
    }
    expect(() =>
      parseDashboardProductState(
        { ...state('loading'), data: { marker: 'validated-loading', eventSequence: 46 } },
        options,
      ),
    ).toThrow('forbidden');
  });

  it('couples every certified reason to its exact tagged presentation state', () => {
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      if (['booting', 'loading', 'ready'].includes(kind)) continue;
      expect(() =>
        parseDashboardProductState(
          { ...state(kind), reasonCodes: ['DASHBOARD_FOREIGN_STATE'] },
          options,
        ),
      ).toThrow('tagged presentation-state reason');
    }
  });

  it('rejects secondary presentation tags while retaining certified non-presentation reasons', () => {
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      if (['booting', 'loading', 'ready'].includes(kind)) continue;
      const ownReason = `DASHBOARD_${kind.toUpperCase().replace('-', '_')}`;
      const otherKind = DASHBOARD_PRODUCT_STATE_KINDS.find(
        (candidate) => candidate !== kind && !['booting', 'loading', 'ready'].includes(candidate),
      );
      const otherReason = `DASHBOARD_${otherKind?.toUpperCase().replace('-', '_')}`;
      expect(() =>
        parseDashboardProductState(
          { ...state(kind), reasonCodes: [ownReason, otherReason] },
          options,
        ),
      ).toThrow('secondary presentation-state substitution');
      expect(
        parseDashboardProductState(
          { ...state(kind), reasonCodes: [ownReason, 'OPERATE_CERTIFIED_REASON'] },
          options,
        ).reasonCodes,
      ).toEqual([ownReason, 'OPERATE_CERTIFIED_REASON']);
    }
  });

  it('normalizes validator failures without echo and rejects unvalidated data', () => {
    const privateMarker = 'private-validator-details-must-not-echo';
    try {
      parseDashboardProductState(state('ready'), {
        currentBinding: binding,
        validateData: (_value: unknown): _value is never => {
          throw new Error(privateMarker);
        },
      });
      expect.fail('hostile validator must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardValidationError);
      expect(String(error)).not.toContain(privateMarker);
    }
    expect(() => parseDashboardProductState(state('ready'), { currentBinding: binding })).toThrow(
      'owner-boundary validator',
    );
  });

  it('replays and restarts from the same validated bytes without listeners, storage, or effects', () => {
    const wire = JSON.stringify(state('recovering'));
    const first = parseDashboardProductStateJson(wire, options);
    const second = parseDashboardProductStateJson(wire, options);
    expect(second).toEqual(first);
    expect(first.mutationEnabled).toBe(false);
    const source = readFileSync(
      resolve('../../apps/dashboard/src/lib/api/product-state.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /localStorage|sessionStorage|addEventListener|fetch\s*\(|PLAN|SHIP/u,
    );
  });
});

describe('closed dashboard safe-error model', () => {
  it('uses the exact finite server-owned public code and context vocabularies', async () => {
    expect(DASHBOARD_SAFE_ERROR_CODES).toEqual([
      'DASHBOARD_ERROR_UNAVAILABLE',
      'DASHBOARD_LOOPBACK_HOST_INVALID',
      'DASHBOARD_BOOTSTRAP_INVALID',
      'CAPABILITY_DENIED',
      'DASHBOARD_BUILD_MISMATCH',
      'DASHBOARD_RESPONSE_INVALID',
      'CONCURRENT_MODIFICATION',
      'OPERATION_UNCERTAIN',
      'DASHBOARD_ASSET_MISSING',
      'DASHBOARD_MANIFEST_INVALID',
      'DASHBOARD_MANIFEST_MISSING',
      'DASHBOARD_READ_FAILED',
      'DASHBOARD_STALE_RESPONSE',
      'OPERATION_CONFLICT',
    ]);
    expect(DASHBOARD_SAFE_CONTEXT_FIELDS).toEqual([
      'operation',
      'cycleId',
      'assignmentId',
      'submissionId',
      'submissionState',
      'reviewId',
      'state',
      'maxBytes',
    ]);
    const installedServer = await import(
      pathToFileURL(join(resolvePipelinePackageRoot(), 'lib/dashboard/server.mjs')).href
    );
    expect(installedServer.DASHBOARD_SAFE_ERROR_CODES).toEqual(DASHBOARD_SAFE_ERROR_CODES);
    expect(installedServer.DASHBOARD_SAFE_CONTEXT_FIELDS).toEqual(DASHBOARD_SAFE_CONTEXT_FIELDS);
    for (const operation of CERTIFIED_HYPHENATED_OPERATIONS) {
      const candidate = {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { operation },
      };
      expect(parseDashboardSafeError(candidate).context.operation).toBe(operation);
      expect(installedServer.assertDashboardSafeError(candidate)).toEqual(candidate);
    }
    for (const candidate of [
      {
        code: 'CONCURRENT_MODIFICATION',
        retryable: true,
        context: { operation: 'operate.review.submit', cycleId: 'cycle-current' },
      },
      { code: 'UNKNOWN_BUT_WELL_FORMED', retryable: false, context: {} },
      {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { cycleId: '/Users/private-marker' },
      },
      {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { ownerActorId: 'private-marker' },
      },
      {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: {},
        message: 'private-marker',
      },
    ]) {
      let clientAccepted = true;
      let serverAccepted = true;
      try {
        parseDashboardSafeError(candidate);
      } catch {
        clientAccepted = false;
      }
      try {
        installedServer.assertDashboardSafeError(candidate);
      } catch {
        serverAccepted = false;
      }
      expect(clientAccepted, JSON.stringify(candidate)).toBe(serverAccepted);
    }
  });

  it('accepts only code, retryability, and bounded primitive allowlisted context', () => {
    const parsed = parseDashboardSafeError({
      code: 'CONCURRENT_MODIFICATION',
      retryable: true,
      context: {
        operation: 'operate.review.submit',
        cycleId: 'cycle-current',
        assignmentId: 'assignment-current',
        submissionId: 'submission-current',
        submissionState: 'awaiting_review',
        reviewId: 'review-current',
        state: 'awaiting_review',
        maxBytes: 65536,
      },
    });
    expect(parsed).toEqual({
      code: 'CONCURRENT_MODIFICATION',
      retryable: true,
      context: {
        operation: 'operate.review.submit',
        cycleId: 'cycle-current',
        assignmentId: 'assignment-current',
        submissionId: 'submission-current',
        submissionState: 'awaiting_review',
        reviewId: 'review-current',
        state: 'awaiting_review',
        maxBytes: 65536,
      },
    });
    expect(Object.isFrozen(parsed.context)).toBe(true);
  });

  it.each([
    { code: 'OK', retryable: false, context: {}, message: 'private body' },
    { code: 'OK', retryable: false, context: { path: '/private/store' } },
    { code: 'OK', retryable: false, context: { operation: { nested: true } } },
    { code: 'lowercase', retryable: false, context: {} },
    { code: 'UNKNOWN_BUT_WELL_FORMED', retryable: false, context: {} },
    { code: 'OK', retryable: 'yes', context: {} },
  ])('rejects malformed, private, or expanded safe-error wire %#', (value) => {
    expect(() => parseDashboardSafeError(value)).toThrow(DashboardValidationError);
  });

  it('rejects path, URL, and private-marker values in every public string context field', () => {
    const hostile = 'https://private-marker.invalid/Users/private-marker';
    for (const field of DASHBOARD_SAFE_CONTEXT_FIELDS) {
      if (field === 'maxBytes') continue;
      const candidate = {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { [field]: hostile },
      };
      expect(() => parseDashboardSafeError(candidate), field).toThrow(DashboardValidationError);
      expect(mapDashboardSafeError(candidate), field).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
      expect(JSON.stringify(mapDashboardSafeError(candidate)), field).not.toContain(
        'private-marker',
      );
    }
    expect(() =>
      parseDashboardSafeError({
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { maxBytes: 16 * 1024 * 1024 + 1 },
      }),
    ).toThrow('bounded byte count');
    for (const operation of [
      '/Users/private-marker',
      'https://private-marker.invalid',
      'operate.review.\u0000private-marker',
      'private-marker',
      'operate.private.marker',
      'foo',
      'ingest-delivery',
    ]) {
      const candidate = {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { operation },
      };
      expect(() => parseDashboardSafeError(candidate), operation).toThrow(DashboardValidationError);
      expect(mapDashboardSafeError(candidate), operation).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    }
  });

  it('bounds every public context string and never echoes oversized input', () => {
    const operation160 = `operate.${'a'.repeat(152)}`;
    const state160 = 'a'.repeat(160);
    expect(operation160).toHaveLength(160);
    expect(state160).toHaveLength(160);
    expect(
      parseDashboardSafeError({
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { operation: operation160, state: state160 },
      }).context,
    ).toEqual({ operation: operation160, state: state160 });

    for (const [field, value] of [
      ['operation', `operate.${'a'.repeat(153)}`],
      ['state', 'a'.repeat(161)],
      ['submissionState', 'a'.repeat(161)],
    ]) {
      const candidate = {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: { [field]: value },
      };
      expect(() => parseDashboardSafeError(candidate), field).toThrow(DashboardValidationError);
      expect(mapDashboardSafeError(candidate), field).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    }

    const oversizedMarker = `${'a'.repeat(200_000)}private-marker`;
    for (const field of DASHBOARD_SAFE_CONTEXT_FIELDS) {
      if (field === 'maxBytes') continue;
      const candidate = {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: {
          [field]: field === 'operation' ? `operate.${oversizedMarker}` : oversizedMarker,
        },
      };
      const mapped = mapDashboardSafeError(candidate);
      expect(mapped, field).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
      expect(JSON.stringify(mapped), field).not.toContain('private-marker');
    }
  });

  it('canonicalizes safe context and matches server prototype rejection', async () => {
    const forward = {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { operation: 'operate.review.submit', cycleId: 'cycle-current', state: 'ready' },
    };
    const reordered = {
      context: { state: 'ready', cycleId: 'cycle-current', operation: 'operate.review.submit' },
      retryable: false,
      code: 'DASHBOARD_RESPONSE_INVALID',
    };
    const installedServer = await import(
      pathToFileURL(join(resolvePipelinePackageRoot(), 'lib/dashboard/server.mjs')).href
    );
    const clientBytes = JSON.stringify(parseDashboardSafeError(reordered));
    expect(clientBytes).toBe(JSON.stringify(parseDashboardSafeError(forward)));
    expect(clientBytes).toBe(JSON.stringify(installedServer.assertDashboardSafeError(reordered)));
    expect(Object.keys(parseDashboardSafeError(reordered).context)).toEqual([
      'operation',
      'cycleId',
      'state',
    ]);

    const custom = Object.assign(Object.create({ privateMarker: true }), forward);
    const nativeError = Object.assign(new Error('private-marker'), forward);
    expect(() => parseDashboardSafeError(custom)).toThrow(DashboardValidationError);
    expect(() => installedServer.assertDashboardSafeError(custom)).toThrow();
    expect(() => parseDashboardSafeError(nativeError)).toThrow(DashboardValidationError);
    expect(() => installedServer.assertDashboardSafeError(nativeError)).toThrow();
    const mappedInternal = installedServer.mapDashboardSafeError(nativeError);
    expect(Object.getPrototypeOf(mappedInternal)).toBe(Object.prototype);
    expect(JSON.stringify(mappedInternal)).not.toContain('private-marker');
    expect(() => installedServer.assertDashboardSafeError(mappedInternal)).not.toThrow();
  });

  it('rejects duplicate members and never preserves hostile error text', () => {
    expect(() =>
      parseDashboardSafeErrorJson('{"code":"OK","code":"FOREIGN","retryable":false,"context":{}}'),
    ).toThrow('duplicate object members');
    const privateMarker = 'private-stack-and-body-must-not-echo';
    const mapped = mapDashboardSafeError({
      reasonCode: 'OPERATION_UNCERTAIN',
      message: privateMarker,
      details: { body: privateMarker },
    });
    expect(mapped).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    expect(JSON.stringify(mapped)).not.toContain(privateMarker);
  });

  it('bounds JSON depth and nodes and normalizes runtime type and scanner failures', () => {
    const arrayAtDepth = `${'['.repeat(64)}0${']'.repeat(64)}`;
    const arrayOverDepth = `${'['.repeat(65)}0${']'.repeat(65)}`;
    const objectAtDepth = `${'{"a":'.repeat(64)}0${'}'.repeat(64)}`;
    const objectOverDepth = `${'{"a":'.repeat(65)}0${'}'.repeat(65)}`;
    expect(() => parseExactJson(arrayAtDepth)).not.toThrow();
    expect(() => parseExactJson(objectAtDepth)).not.toThrow();
    expect(() => parseExactJson(arrayOverDepth)).toThrow('JSON complexity limit');
    expect(() => parseExactJson(objectOverDepth)).toThrow('JSON complexity limit');

    const nodesAtLimit = `[${Array.from({ length: 4095 }, () => '0').join(',')}]`;
    const nodesOverLimit = `[${Array.from({ length: 4096 }, () => '0').join(',')}]`;
    expect(() => parseExactJson(nodesAtLimit)).not.toThrow();
    expect(() => parseExactJson(nodesOverLimit)).toThrow('JSON complexity limit');

    const privateMarker = 'private-json-scanner-marker';
    for (const hostile of [
      `${'['.repeat(10_000)}0${']'.repeat(10_000)}`,
      '{"code":"DASHBOARD_RESPONSE_INVALID","retryable":false,"context":{"state":"\\qprivate-json-scanner-marker"}}',
    ]) {
      try {
        parseDashboardSafeErrorJson(hostile);
        expect.fail('hostile JSON must reject');
      } catch (error) {
        expect(error).toBeInstanceOf(DashboardValidationError);
        expect(error).not.toBeInstanceOf(RangeError);
        expect(String(error)).not.toContain(privateMarker);
      }
    }
    for (const nonString of [null, 42, {}, []]) {
      try {
        parseExactJson(nonString as unknown as string);
        expect.fail('non-string JSON input must reject');
      } catch (error) {
        expect(error).toBeInstanceOf(DashboardValidationError);
        expect((error as Error).message).toBe('$: expected a JSON string');
      }
    }
  });

  it('rejects accessors and exceptional proxies without echoing their details', () => {
    const accessor = Object.defineProperty({}, 'code', {
      get: vi.fn(() => 'OPERATION_UNCERTAIN'),
      enumerable: true,
    });
    Object.assign(accessor, { retryable: false, context: {} });
    expect(mapDashboardSafeError(accessor)).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    expect(Object.getOwnPropertyDescriptor(accessor, 'code')?.get).not.toHaveBeenCalled();

    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private-proxy-trap');
        },
      },
    );
    expect(mapDashboardSafeError(proxy)).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);

    let getCalls = 0;
    const descriptorSafeProxy = new Proxy(
      { code: 'OPERATION_UNCERTAIN', retryable: false, context: {} },
      {
        get() {
          getCalls += 1;
          throw new Error('private-marker-from-get-trap');
        },
      },
    );
    expect(mapDashboardSafeError(descriptorSafeProxy)).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    expect(() => parseDashboardSafeError(descriptorSafeProxy)).toThrow(DashboardValidationError);
    expect(getCalls).toBe(0);

    let nestedGetterCalls = 0;
    const nestedAccessor = Object.defineProperty({}, 'privateMarker', {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return 'private-marker-from-nested-getter';
      },
    });
    expect(
      mapDashboardSafeError({
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: nestedAccessor,
      }),
    ).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    expect(nestedGetterCalls).toBe(0);

    let nestedProxyGetCalls = 0;
    const nestedProxy = new Proxy(
      { operation: 'operate.review.submit' },
      {
        get() {
          nestedProxyGetCalls += 1;
          throw new Error('private-marker-from-nested-proxy');
        },
      },
    );
    expect(
      mapDashboardSafeError({
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: nestedProxy,
      }),
    ).toBe(DASHBOARD_SAFE_ERROR_FALLBACK);
    expect(nestedProxyGetCalls).toBe(0);
  });

  it('classifies retryability as reconciliation information, never blind retry', () => {
    for (const retryable of [true, false]) {
      const policy = dashboardErrorRecoveryPolicy(
        parseDashboardSafeError({ code: 'CONCURRENT_MODIFICATION', retryable, context: {} }),
      );
      expect(policy).toEqual({
        blindRetry: false,
        requiresReconciliation: true,
        retryableAfterReconciliation: retryable,
      });
    }
  });
});
