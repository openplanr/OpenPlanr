// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { selectOperateExperienceDisplaySurface } from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import {
  LiveStateBoundary,
  useLiveStateBoundary,
  useStableLiveOrder,
} from '../../../../apps/dashboard/src/features/shell/LiveStateBoundary.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  type BoundProjectionOptions,
  createBoundProjectionController,
  useBoundProjection,
} from '../../../../apps/dashboard/src/lib/query/use-bound-projection.js';

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const CYCLE_ID = 'cycle-1';
const STAGE_IDS = ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'] as const;

/** One canonical Operate view at an exact event head, sealed with its contract viewHash. */
function canonicalView(sequence: number, headCharacter: string) {
  const eventHead = { sequence, hash: hash(headCharacter) };
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_livestate01',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-acme',
    accessLevel: 'public',
    generatedAt: '2026-08-14T00:00:00.000Z',
    eventHead,
    sourceStateHash: hash('1'),
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: CYCLE_ID,
        state: 'created',
        health: 'normal',
        focus: ['Verified live snapshot'],
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
        stages: STAGE_IDS.map((id, index) => ({
          id,
          state: index === 0 ? 'current' : 'waiting',
          reason: null,
          inputArtifactIds: [],
          outputArtifactIds: [],
          gates: [],
          evidenceGapIds: [],
          uncertaintyIds: [],
          persistentActionIds: [],
        })),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${CYCLE_ID}`,
      },
    ],
    inbox: [],
    actions: [],
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: sequence,
        eventCount: sequence,
        eventReplayIndexHash: hash('2'),
      },
      finalHead: eventHead,
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: hash('1'),
        eventReplayIndexHash: hash('2'),
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: true,
      },
      filterDimensions: [],
      redactions: [],
    },
    allowedActions: [],
    omissions: [],
    export: { formats: ['json'], accessSafe: true, redactionCount: 0 },
  };
  return { ...base, viewHash: sha256Jcs(base as never) };
}

/** The exact Today display surface the live transport serves for that view. */
function issuedSurface(sequence: number, headCharacter: string) {
  const view = canonicalView(sequence, headCharacter);
  const display = selectOperateExperienceDisplaySurface(view, {
    surface: 'today',
    binding: {
      actorId: view.actorId,
      scopeId: view.scopeId,
      domainId: view.domainId,
      domainVersion: view.domainVersion,
      generatedAt: view.generatedAt,
      eventHead: view.eventHead,
      viewHash: view.viewHash,
      surface: 'today',
      subjectId: null,
      cycleId: CYCLE_ID,
    } as never,
    cycleId: CYCLE_ID,
  }) as {
    payload: {
      eventHead: { sequence: number; hash: string };
      viewHash: string;
      mutationEnabled: boolean;
      reasonCodes: readonly string[];
    };
  };
  if (!('payload' in display)) throw new Error('display surface is unavailable');
  return display;
}

const issued = [issuedSurface(1, 'b'), issuedSurface(2, 'd'), issuedSurface(3, 'f')] as const;
const cursorOf = (display: (typeof issued)[number]) => ({
  eventHead: display.payload.eventHead,
  viewHash: display.payload.viewHash,
});
const baseCursor = cursorOf(issued[0]);
const nextCursor = cursorOf(issued[1]);
const thirdCursor = cursorOf(issued[2]);
const current = createDashboardQueryIdentity({
  productArea: 'operate',
  route: '#/operate/actions/action-1',
  actorId: 'owner-acme',
  projectId: hash('a'),
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  cycleId: CYCLE_ID,
  subjectId: 'action-1',
  eventHead: { sequence: 1, hash: hash('b') },
  viewHash: hash('c'),
  generation: 7,
});

const todayIdentity = createDashboardQueryIdentity({
  ...current,
  route: '#/operate/today',
  subjectId: null,
  eventHead: baseCursor.eventHead,
  viewHash: baseCursor.viewHash,
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function snapshotSurface(eventCursor = baseCursor) {
  const display = issued.find(
    (entry) => entry.payload.eventHead.sequence === eventCursor.eventHead.sequence,
  );
  if (!display) throw new Error('no issued display surface for that cursor');
  return display;
}

function surface(eventCursor = baseCursor) {
  return snapshotSurface(eventCursor).payload;
}

function envelope(event: string, payload: unknown, eventCursor = baseCursor) {
  return JSON.stringify({
    kind: 'dashboard-live-event',
    schemaVersion: '1.0.0',
    event,
    binding: {
      actorId: todayIdentity.actorId,
      projectId: todayIdentity.projectId,
      scopeId: todayIdentity.scopeId,
      domainId: todayIdentity.domainId,
      domainVersion: todayIdentity.domainVersion,
      generation: todayIdentity.generation,
    },
    cursor: eventCursor,
    payload,
  });
}

function patchSignal(from: typeof baseCursor, to: typeof baseCursor, suffix: string) {
  return {
    patchId: `xpatch_${suffix.repeat(8)}`,
    patchHash: hash(suffix),
    from,
    to,
    changedPaths: ['/status'],
  };
}

function sseTransport() {
  const encoder = new TextEncoder();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  return {
    fetcher: vi.fn(async () => response),
    emit(event: string, payload: unknown, eventCursor = baseCursor) {
      body.enqueue(
        encoder.encode(`event: ${event}\ndata: ${envelope(event, payload, eventCursor)}\n\n`),
      );
    },
    close() {
      body.close();
    },
  };
}

const reconcile = (value: ReturnType<typeof surface>) => ({
  cursor: { eventHead: value.eventHead, viewHash: value.viewHash },
  mutationEnabled: value.mutationEnabled,
  reasonCodes: value.reasonCodes,
});

let mountSequence = 0;

function Probe({ items = ['a', 'b'] }: { items?: readonly string[] }) {
  const [instance] = useState(() => ++mountSequence);
  const [filter, setFilter] = useState('open');
  const [selected, setSelected] = useState('a');
  const ordered = useStableLiveOrder(items, (item) => item);
  const live = useLiveStateBoundary();
  return (
    <div data-instance={String(instance)}>
      <label>
        Filter
        <input
          aria-label="Filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <output data-testid="order">{ordered.join(',')}</output>
      <output data-testid="pointer">{String(live.pointerActive)}</output>
      <ul>
        {ordered.map((item) => (
          <li key={item}>
            <button
              type="button"
              aria-pressed={selected === item}
              onClick={() => setSelected(item)}
            >
              Select {item}
            </button>
          </li>
        ))}
      </ul>
      <details data-live-unsafe-control>
        <summary>Inspect</summary>
        <button type="button">Unsafe control</button>
      </details>
      <button type="button" data-live-focus-return>
        Safe return
      </button>
    </div>
  );
}

function ProjectionProbe<T>({
  options,
  observations,
}: {
  options: BoundProjectionOptions<T>;
  observations: string[];
}) {
  const projection = useBoundProjection(options);
  const label =
    projection.data && typeof projection.data === 'object' && 'label' in projection.data
      ? String(projection.data.label)
      : projection.data
        ? 'surface'
        : 'none';
  const observation = `${projection.phase}:${label}:${String(projection.mutationEnabled)}`;
  observations.push(observation);
  return <output data-testid="projection">{observation}</output>;
}

function InlineCallbackProbe({ onRead }: { onRead: () => void }) {
  const projection = useBoundProjection({
    identity: todayIdentity,
    read: async () => {
      onRead();
      return { label: 'inline-current' };
    },
    validate: (value) => value as { label: string },
  });
  return (
    <output data-testid="inline-projection">
      {projection.phase}:{projection.data?.label ?? 'none'}
    </output>
  );
}

describe('route-scoped live state boundary', () => {
  it('preserves the mounted child, focus, filters, and scroll for cursor-only progress', () => {
    const route = parseDashboardRoute(current.route);
    const subject = render(
      <LiveStateBoundary route={route} binding={current}>
        <Probe />
      </LiveStateBoundary>,
    );
    const filter = screen.getByLabelText('Filter') as HTMLInputElement;
    fireEvent.change(filter, { target: { value: 'review-required' } });
    filter.focus();
    filter.setSelectionRange(1, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Select b' }));
    const details = screen.getByText('Inspect').closest('details');
    if (!details) throw new Error('missing details');
    details.open = true;
    Object.defineProperty(subject.container.firstElementChild, 'scrollTop', {
      configurable: true,
      value: 73,
      writable: true,
    });
    const instance = screen.getByTestId('order').parentElement?.getAttribute('data-instance');
    const progressed = createDashboardQueryIdentity({
      ...current,
      eventHead: { sequence: 2, hash: hash('d') },
      viewHash: hash('e'),
    });
    subject.rerender(
      <LiveStateBoundary route={route} binding={progressed}>
        <Probe />
      </LiveStateBoundary>,
    );
    expect(screen.getByTestId('order').parentElement?.getAttribute('data-instance')).toBe(instance);
    expect((screen.getByLabelText('Filter') as HTMLInputElement).value).toBe('review-required');
    expect(document.activeElement).toBe(screen.getByLabelText('Filter'));
    expect((screen.getByLabelText('Filter') as HTMLInputElement).selectionStart).toBe(1);
    expect((screen.getByLabelText('Filter') as HTMLInputElement).selectionEnd).toBe(2);
    expect(screen.getByRole('button', { name: 'Select b' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(details.open).toBe(true);
    expect(subject.container.firstElementChild?.scrollTop).toBe(73);
  });

  it('holds order through a pointer gesture and releases on window pointerup', () => {
    const route = parseDashboardRoute(current.route);
    const subject = render(
      <LiveStateBoundary route={route} binding={current}>
        <Probe />
      </LiveStateBoundary>,
    );
    const pointerTarget = screen.getByRole('button', { name: 'Safe return' });
    pointerTarget.addEventListener('pointerdown', (event) => event.stopPropagation(), {
      once: true,
    });
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointerDown, 'isPrimary', { value: true });
    act(() => pointerTarget.dispatchEvent(pointerDown));
    subject.rerender(
      <LiveStateBoundary route={route} binding={current}>
        <Probe items={['b', 'a', 'c']} />
      </LiveStateBoundary>,
    );
    expect(screen.getByTestId('order').textContent).toBe('a,b,c');
    pointerTarget.addEventListener('pointerup', (event) => event.stopPropagation(), { once: true });
    act(() => pointerTarget.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(screen.getByTestId('pointer').textContent).toBe('false');
    subject.rerender(
      <LiveStateBoundary route={route} binding={current}>
        <Probe items={['b', 'a', 'c']} />
      </LiveStateBoundary>,
    );
    expect(screen.getByTestId('order').textContent).toBe('b,a,c');
  });

  it('ignores a foreign subject transition and applies an exact supersession safely', () => {
    const route = parseDashboardRoute(current.route);
    const subject = render(
      <LiveStateBoundary
        route={route}
        binding={current}
        transition={{ kind: 'deleted', subjectId: 'foreign-action' }}
      >
        <Probe />
      </LiveStateBoundary>,
    );
    expect(screen.queryByText('This item is no longer available')).toBeNull();
    subject.rerender(
      <LiveStateBoundary
        route={route}
        binding={current}
        transition={{
          kind: 'superseded',
          subjectId: 'action-1',
          successorHref: '#/operate/actions/action-2',
        }}
      >
        <Probe />
      </LiveStateBoundary>,
    );
    expect(screen.getByText('This item has a newer successor')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open Action detail' }).getAttribute('href')).toBe(
      '#/operate/actions/action-2',
    );
    expect(screen.getByRole('link', { name: 'Open Action detail' }).className).toContain(
      'op-inline-action',
    );
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open Action detail' }));
    expect(subject.container.textContent).not.toContain('/Users/');
  });

  it('closes unsafe controls and restores focus when route scope changes', () => {
    const route = parseDashboardRoute(current.route);
    const subject = render(
      <LiveStateBoundary route={route} binding={current}>
        <Probe />
      </LiveStateBoundary>,
    );
    const details = screen.getByText('Inspect').closest('details');
    if (!details) throw new Error('missing details');
    details.open = true;
    screen.getByRole('button', { name: 'Unsafe control' }).focus();
    const next = createDashboardQueryIdentity({
      ...current,
      route: '#/operate/actions/action-2',
      subjectId: 'action-2',
      generation: 8,
    });
    subject.rerender(
      <LiveStateBoundary route={parseDashboardRoute(next.route)} binding={next}>
        <Probe />
      </LiveStateBoundary>,
    );
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Safe return' }));
  });

  it('focuses its explicit fallback and has no applicable axe violations when deleted', async () => {
    const route = parseDashboardRoute(current.route);
    const subject = render(
      <LiveStateBoundary
        route={route}
        binding={current}
        transition={{ kind: 'deleted', subjectId: 'action-1' }}
      >
        <p>Current detail was removed.</p>
      </LiveStateBoundary>,
    );
    expect(document.activeElement).toBe(subject.container.firstElementChild);
    const result = await axe.run(subject.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it('removes global pointer cleanup listeners on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const route = parseDashboardRoute(current.route);
    const subject = render(
      <LiveStateBoundary route={route} binding={current}>
        <Probe />
      </LiveStateBoundary>,
    );
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointerDown, 'isPrimary', { value: true });
    act(() => subject.container.firstElementChild?.dispatchEvent(pointerDown));
    subject.unmount();
    expect(add).toHaveBeenCalledWith('pointerup', expect.any(Function), {
      capture: true,
      once: true,
    });
    expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function), { capture: true });
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('bound live projection coordinator', () => {
  it('settles one read when callers use idiomatic inline callbacks', async () => {
    const onRead = vi.fn();
    render(<InlineCallbackProbe onRead={onRead} />);
    await waitFor(() =>
      expect(screen.getByTestId('inline-projection').textContent).toBe('ready:inline-current'),
    );
    await act(async () => Promise.resolve());
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('rejects a noncanonical source key without echoing it', () => {
    const controller = createBoundProjectionController();
    expect(() =>
      controller.activate({
        identity: todayIdentity,
        sourceKey: '/PRIVATE/Users/owner',
        read: async () => ({ label: 'never' }),
        validate: (value) => value as { label: string },
      }),
    ).toThrowError('Bound projection source key is invalid.');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE');
    controller.dispose();
  });

  it('keeps an explicitly configured empty live origin fail-closed in the hook', async () => {
    const observations: string[] = [];
    render(
      <ProjectionProbe
        observations={observations}
        options={{
          identity: todayIdentity,
          read: async () => surface(),
          validate: (value) => value as ReturnType<typeof surface>,
          live: { origin: '', reconcile },
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('projection').textContent).toBe('stale:surface:false'),
    );
    expect(observations).not.toContain('ready:surface:false');
  });

  it('coalesces an exact direct-route read and aborts it on disposal', async () => {
    const controller = createBoundProjectionController();
    const pending = deferred<{ label: string }>();
    let capturedSignal: AbortSignal | null = null;
    const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
      capturedSignal = signal;
      return pending.promise;
    });
    const options = {
      identity: todayIdentity,
      read,
      validate: (value: unknown) => value as { label: string },
    } satisfies BoundProjectionOptions<{ label: string }>;
    controller.activate(options);
    controller.activate(options);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    controller.dispose();
    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
    pending.resolve({ label: 'late' });
  });

  it('performs one direct read and one live connection under StrictMode replay', async () => {
    const transport = sseTransport();
    const read = vi.fn(async () => surface());
    const observations: string[] = [];
    const subject = render(
      <StrictMode>
        <ProjectionProbe
          observations={observations}
          options={{
            identity: todayIdentity,
            read,
            validate: (value) => value as ReturnType<typeof surface>,
            live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
          }}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('projection').textContent).toContain('ready'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.fetcher).toHaveBeenCalledTimes(1);
    subject.unmount();
    act(() => transport.close());
  });

  it('fails a malformed live source closed while retaining a validated direct read', async () => {
    const controller = createBoundProjectionController();
    const read = vi.fn(async () => surface());
    expect(() =>
      controller.activate({
        identity: todayIdentity,
        read,
        validate: (value) => value as ReturnType<typeof surface>,
        live: {
          origin: 'https://PRIVATE.example/Users/owner',
          reconcile,
        },
      }),
    ).not.toThrow();
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('stale'));
    expect(read).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().data).toEqual(surface());
    expect(controller.getSnapshot().mutationEnabled).toBe(false);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE');
    controller.dispose();
  });

  it('retains a late validated read after an asynchronous live failure', async () => {
    const controller = createBoundProjectionController();
    const pending = deferred<ReturnType<typeof surface>>();
    const fetcher = vi.fn(async () => {
      throw new Error('PRIVATE_/Users/owner/secret');
    });
    controller.activate({
      identity: todayIdentity,
      read: () => pending.promise,
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher, reconcile },
    });
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('stale'));
    pending.resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().data).toEqual(surface()));
    expect(controller.getSnapshot().phase).toBe('stale');
    expect(controller.getSnapshot().mutationEnabled).toBe(false);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE');
    controller.dispose();
  });

  it('clears obsolete live-failure state when replacing the source with a direct read', async () => {
    const controller = createBoundProjectionController();
    const fetcher = vi.fn(async () => {
      throw new Error('PRIVATE_old_live_source');
    });
    controller.activate({
      identity: todayIdentity,
      read: async () => surface(),
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher, reconcile },
    });
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('stale'));
    controller.activate({
      identity: todayIdentity,
      read: async () => ({ label: 'direct-current' }),
      validate: (value) => value as { label: string },
    });
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    expect(controller.getSnapshot()).toMatchObject({
      data: { label: 'direct-current' },
      mutationEnabled: false,
      reason: null,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE');
    controller.dispose();
  });

  it('aborts a foreign binding read and never publishes its late result', async () => {
    const controller = createBoundProjectionController();
    const first = deferred<{ label: string }>();
    const second = deferred<{ label: string }>();
    let firstSignal: AbortSignal | null = null;
    const firstIdentity = todayIdentity;
    const secondIdentity = createDashboardQueryIdentity({
      ...todayIdentity,
      actorId: 'owner-beta',
      scopeId: 'scope-beta',
      generation: todayIdentity.generation + 1,
    });
    controller.activate({
      identity: firstIdentity,
      read: ({ signal }) => {
        firstSignal = signal;
        return first.promise;
      },
      validate: (value) => value as { label: string },
    });
    await waitFor(() => expect(firstSignal).not.toBeNull());
    controller.activate({
      identity: secondIdentity,
      read: () => second.promise,
      validate: (value) => value as { label: string },
    });
    expect((firstSignal as AbortSignal | null)?.aborted).toBe(true);
    first.resolve({ label: 'PRIVATE_OLD_BINDING' });
    second.resolve({ label: 'current-binding' });
    await waitFor(() =>
      expect(controller.getSnapshot().data).toEqual({ label: 'current-binding' }),
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE_OLD_BINDING');
    controller.dispose();
  });

  it('masks a same-binding fork immediately but keeps controller-owned cursor progress visible', async () => {
    const observations: string[] = [];
    const firstIdentity = createDashboardQueryIdentity({
      ...todayIdentity,
      eventHead: thirdCursor.eventHead,
      viewHash: thirdCursor.viewHash,
    });
    const forkedRequest = createDashboardQueryIdentity({
      ...todayIdentity,
      eventHead: nextCursor.eventHead,
      viewHash: hash('9'),
    });
    const forkRead = deferred<{ label: string }>();
    const read = vi.fn(({ identity }: { identity: typeof todayIdentity }) =>
      identity.eventHead?.hash === firstIdentity.eventHead?.hash
        ? Promise.resolve({ label: 'old-branch' })
        : forkRead.promise,
    );
    const validate = (value: unknown) => value as { label: string };
    const subject = render(
      <ProjectionProbe
        observations={observations}
        options={{ identity: firstIdentity, read, validate }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('projection').textContent).toBe('ready:old-branch:false'),
    );
    const observationStart = observations.length;
    subject.rerender(
      <ProjectionProbe
        observations={observations}
        options={{ identity: forkedRequest, read, validate }}
      />,
    );
    expect(observations.slice(observationStart)[0]).toBe('loading:none:false');
    await waitFor(() =>
      expect(screen.getByTestId('projection').textContent).toBe('loading:none:false'),
    );
    expect(observations.slice(observationStart).every((entry) => entry.includes(':none:'))).toBe(
      true,
    );
    forkRead.resolve({ label: 'new-branch' });
    await waitFor(() =>
      expect(screen.getByTestId('projection').textContent).toBe('ready:new-branch:false'),
    );

    const liveObservations: string[] = [];
    const transport = sseTransport();
    const initial = createDashboardQueryIdentity({
      ...todayIdentity,
      eventHead: null,
      viewHash: null,
    });
    const initialRead = deferred<ReturnType<typeof surface>>();
    subject.rerender(
      <ProjectionProbe
        observations={liveObservations}
        options={{
          identity: initial,
          read: () => initialRead.promise,
          validate: (value) => value as ReturnType<typeof surface>,
          live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
        }}
      />,
    );
    await waitFor(() => expect(transport.fetcher).toHaveBeenCalledOnce());
    act(() => {
      transport.emit('snapshot', snapshotSurface());
      transport.emit('ready', { mutationEnabled: true, reasonCodes: [] });
    });
    await waitFor(() =>
      expect(screen.getByTestId('projection').textContent).toBe('ready:surface:true'),
    );
    expect(liveObservations).toContain('ready:surface:true');
    act(() => transport.close());
    await waitFor(() =>
      expect(screen.getByTestId('projection').textContent).toBe('stale:surface:false'),
    );
    initialRead.resolve(surface());
  });

  it('lets an SSE snapshot supersede a delayed initial read and fails closed on clean EOF', async () => {
    const controller = createBoundProjectionController();
    const transport = sseTransport();
    const pending = deferred<ReturnType<typeof surface>>();
    const identity = createDashboardQueryIdentity({
      ...todayIdentity,
      eventHead: null,
      viewHash: null,
    });
    controller.activate({
      identity,
      read: () => pending.promise,
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
    });
    await waitFor(() => expect(transport.fetcher).toHaveBeenCalledOnce());
    act(() => {
      transport.emit('snapshot', snapshotSurface());
      transport.emit('ready', { mutationEnabled: true, reasonCodes: [] });
    });
    await waitFor(() => expect(controller.getSnapshot().mutationEnabled).toBe(true));
    expect(controller.getSnapshot().identity?.eventHead).toEqual(baseCursor.eventHead);
    pending.resolve(surface());
    await act(async () => Promise.resolve());
    expect(controller.getSnapshot().identity?.eventHead).toEqual(baseCursor.eventHead);
    act(() => transport.close());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('stale'));
    expect(controller.getSnapshot().mutationEnabled).toBe(false);
    controller.dispose();
  });

  it('queues a trailing full read when another patch arrives during reconciliation', async () => {
    const controller = createBoundProjectionController();
    const transport = sseTransport();
    const reads = [
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
    ];
    let readIndex = 0;
    const read = vi.fn(() => reads[readIndex++].promise);
    controller.activate({
      identity: todayIdentity,
      read,
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    reads[0].resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    act(() => transport.emit('patch', patchSignal(baseCursor, nextCursor, '6'), nextCursor));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().mutationEnabled).toBe(false);
    act(() => transport.emit('patch', patchSignal(nextCursor, thirdCursor, '7'), thirdCursor));
    reads[1].resolve(surface(nextCursor));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    reads[2].resolve(surface(thirdCursor));
    await waitFor(() => {
      expect(controller.getSnapshot().phase).toBe('ready');
      expect(controller.getSnapshot().identity?.eventHead).toEqual(thirdCursor.eventHead);
    });
    controller.dispose();
  });

  it('keeps retained data bound to its exact cursor while the next read is pending', async () => {
    const controller = createBoundProjectionController();
    const transport = sseTransport();
    const reads = [
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
    ];
    let readIndex = 0;
    controller.activate({
      identity: todayIdentity,
      read: () => reads[readIndex++].promise,
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
    });
    reads[0].resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    act(() => transport.emit('patch', patchSignal(baseCursor, nextCursor, 'a'), nextCursor));
    await waitFor(() => expect(readIndex).toBe(2));
    reads[1].resolve(surface(nextCursor));
    await waitFor(() =>
      expect(controller.getSnapshot().identity?.eventHead).toEqual(nextCursor.eventHead),
    );
    act(() => transport.emit('patch', patchSignal(nextCursor, thirdCursor, 'b'), thirdCursor));
    await waitFor(() => expect(readIndex).toBe(3));
    expect(controller.getSnapshot().phase).toBe('refreshing');
    expect(controller.getSnapshot().data).toEqual(surface(nextCursor));
    expect(controller.getSnapshot().identity?.eventHead).toEqual(nextCursor.eventHead);
    reads[2].reject(new Error('PRIVATE_read_failure'));
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('stale'));
    expect(controller.getSnapshot().identity?.eventHead).toEqual(nextCursor.eventHead);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE');
    controller.dispose();
  });

  it('deduplicates an actual cursor gap into one bound full refetch', async () => {
    const controller = createBoundProjectionController();
    const transport = sseTransport();
    const initial = deferred<ReturnType<typeof surface>>();
    const reconciled = deferred<ReturnType<typeof surface>>();
    const reads = [initial, reconciled];
    let readIndex = 0;
    const read = vi.fn(() => reads[readIndex++].promise);
    controller.activate({
      identity: todayIdentity,
      read,
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    initial.resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    const gap = patchSignal(baseCursor, thirdCursor, '9');
    act(() => {
      transport.emit('patch', gap, thirdCursor);
      transport.emit('patch', gap, thirdCursor);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().phase).toBe('refreshing');
    expect(controller.getSnapshot().mutationEnabled).toBe(false);
    reconciled.resolve(surface(thirdCursor));
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().identity?.eventHead).toEqual(thirdCursor.eventHead);
    controller.dispose();
  });

  it('lets an authoritative snapshot replace a non-cooperative refetch', async () => {
    const controller = createBoundProjectionController();
    const transport = sseTransport();
    const reads = [
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
    ];
    let readIndex = 0;
    const read = vi.fn(() => reads[readIndex++].promise);
    controller.activate({
      identity: todayIdentity,
      read,
      validate: (value) => value as ReturnType<typeof surface>,
      live: { origin: 'http://127.0.0.1:4567', fetcher: transport.fetcher, reconcile },
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    reads[0].resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    act(() => transport.emit('patch', patchSignal(baseCursor, nextCursor, '2'), nextCursor));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    act(() => {
      transport.emit('snapshot', snapshotSurface(nextCursor), nextCursor);
      transport.emit('ready', { mutationEnabled: true, reasonCodes: [] }, nextCursor);
    });
    await waitFor(() => expect(controller.getSnapshot().mutationEnabled).toBe(true));
    act(() => transport.emit('patch', patchSignal(nextCursor, thirdCursor, '3'), thirdCursor));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    reads[2].resolve(surface(thirdCursor));
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    expect(controller.getSnapshot().identity?.eventHead).toEqual(thirdCursor.eventHead);
    controller.dispose();
  });

  it('ignores an old stream completion after a same-identity source replacement', async () => {
    const controller = createBoundProjectionController();
    const oldTransport = sseTransport();
    const newTransport = sseTransport();
    const oldReads = [
      deferred<ReturnType<typeof surface>>(),
      deferred<ReturnType<typeof surface>>(),
    ];
    let oldReadIndex = 0;
    const oldRead = vi.fn(() => oldReads[oldReadIndex++].promise);
    const newRead = deferred<ReturnType<typeof surface>>();
    const validate = (value: unknown) => value as ReturnType<typeof surface>;
    controller.activate({
      identity: todayIdentity,
      sourceKey: 'old-source',
      read: oldRead,
      validate,
      live: { origin: 'http://127.0.0.1:4567', fetcher: oldTransport.fetcher, reconcile },
    });
    await waitFor(() => expect(oldTransport.fetcher).toHaveBeenCalledOnce());
    oldReads[0].resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    act(() => oldTransport.emit('patch', patchSignal(baseCursor, nextCursor, '4'), nextCursor));
    await waitFor(() => expect(oldRead).toHaveBeenCalledTimes(2));
    controller.activate({
      identity: todayIdentity,
      sourceKey: 'new-source',
      read: () => newRead.promise,
      validate,
      live: { origin: 'http://127.0.0.1:4567', fetcher: newTransport.fetcher, reconcile },
    });
    await waitFor(() => expect(newTransport.fetcher).toHaveBeenCalledOnce());
    newRead.resolve(surface());
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    oldReads[1].resolve(surface(nextCursor));
    act(() => oldTransport.close());
    await act(async () => Promise.resolve());
    expect(controller.getSnapshot().phase).toBe('ready');
    expect(controller.getSnapshot().identity?.eventHead).toEqual(baseCursor.eventHead);
    controller.dispose();
  });
});
