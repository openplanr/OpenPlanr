/**
 * Read-only Operating Board projection.
 *
 * The browser never reduces events or mutates operating state. It renders only
 * the validated `/api/operate` projection and hands every write back to the CLI.
 */

const ROLE_LABELS = {
  'strategy-finance': 'CEO',
  'technology-risk': 'CTO',
  'product-activation': 'CPO',
  'growth-market': 'CMO',
  'operations-customer': 'COO',
  chair: 'Chair',
};

let mountedRoot = null;

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text != null) node.textContent = options.text;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function sorted(values, key = 'updatedAt') {
  return [...(Array.isArray(values) ? values : [])].sort(
    (left, right) => String(right?.[key] ?? '').localeCompare(String(left?.[key] ?? '')),
  );
}

function currentCycle(state) {
  return (
    state.cycles.find((cycle) => cycle.id === state.summary.currentCycleId) ??
    sorted(state.cycles).at(0) ??
    null
  );
}

function primaryFinding(state, cycle) {
  return [...state.findings]
    .filter((finding) => !cycle || finding.cycleId === cycle.id)
    .sort(
      (left, right) =>
        Number(right.criticalOverride) - Number(left.criticalOverride) ||
        Number(right.score ?? 0) - Number(left.score ?? 0) ||
        String(left.id).localeCompare(String(right.id)),
    )
    .at(0) ?? null;
}

export function deriveOperatingViewModel(state) {
  const cycle = currentCycle(state);
  const finding = primaryFinding(state, cycle);
  const route =
    state.routes.find(
      (candidate) =>
        candidate.cycleId === cycle?.id &&
        (!finding || candidate.findingIds?.includes(finding.id)),
    ) ?? null;
  const specLink =
    state.specLinks.find(
      (candidate) =>
        candidate.cycleId === cycle?.id &&
        (!finding || candidate.findingId === finding.id),
    ) ?? null;
  const outcome =
    state.outcomes.find((candidate) => candidate.specId === specLink?.specId) ??
    sorted(state.outcomes).at(0) ??
    null;
  const decisions = state.decisions.filter((record) => !cycle || record.cycleId === cycle.id);
  const gaps = state.dataGaps.filter((record) => !cycle || record.cycleId === cycle.id);
  const affectedRoleIds = new Set(
    gaps.flatMap((gap) => (Array.isArray(gap.affectedRoles) ? gap.affectedRoles : [])),
  );
  const enabledRoleIds = new Set(cycle?.enabledRoles ?? []);
  const lenses = Object.entries(ROLE_LABELS).map(([id, label]) => ({
    id,
    label,
    state: affectedRoleIds.has(id)
      ? 'needs-evidence'
      : enabledRoleIds.has(id)
        ? 'enabled'
        : 'not-enabled',
  }));
  return {
    cycle,
    priorCycles: state.cycles.filter((record) => record.id !== cycle?.id),
    finding,
    route,
    specLink,
    outcome,
    decision: sorted(decisions, 'deadline').at(-1) ?? decisions.at(0) ?? null,
    gap: gaps.at(0) ?? null,
    lenses,
    evidenceSources: state.evidenceSources,
    summary: state.summary,
    eventHead: state.eventHead,
    outcomes: state.outcomes,
    learnings: state.learnings,
  };
}

function statusPill(label, tone = 'neutral') {
  return el('span', {
    class: `op-pill op-pill--${tone}`,
    text: label,
  });
}

function cliHandoff(command, label = 'Copy command') {
  const code = el('code', { class: 'op-command__code', text: command });
  const button = el('button', {
    class: 'op-copy',
    text: label,
    attrs: { type: 'button', 'aria-label': `${label}: ${command}` },
  });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = original;
      }, 1600);
    } catch {
      button.textContent = 'Copy failed';
    }
  });
  return el('div', { class: 'op-command' }, [code, button]);
}

function statePanel(title, message, command, tone = 'neutral') {
  return el('section', { class: `op-state op-state--${tone}` }, [
    el('p', { class: 'op-kicker', text: 'Operating Board' }),
    el('h1', { text: title }),
    el('p', { text: message }),
    cliHandoff(command),
  ]);
}

function renderCausalThread(model) {
  const evidenceCount = model.evidenceSources.reduce(
    (total, source) => total + Number(source.itemCount ?? 0),
    0,
  );
  const steps = [
    {
      id: 'evidence',
      label: 'Evidence',
      title: `${evidenceCount} verified references`,
      body:
        model.evidenceSources
          .map((source) => `${source.id} · ${source.freshness}`)
          .join(' · ') || 'No evidence metadata recorded.',
    },
    {
      id: 'constraint',
      label: 'Constraint',
      title: model.finding?.title ?? model.summary.currentConstraint ?? 'No surfaced constraint',
      body: model.finding?.problem ?? 'The current cycle did not surface a finding.',
    },
    {
      id: 'route',
      label: 'Route',
      title: model.finding
        ? `${model.finding.lane} · ${model.route?.state ?? model.finding.status}`
        : 'No route proposed',
      body: model.finding?.proposal ?? 'A quiet cycle needs no route.',
    },
    {
      id: 'outcome',
      label: 'Outcome',
      title: model.outcome?.status ?? 'Not observed',
      body: model.outcome?.metric ?? 'Outcome evidence will appear after a linked spec ships.',
    },
  ];
  const list = el('ol', {
    class: 'op-thread',
    attrs: { 'aria-label': 'Evidence to outcome causal thread' },
  });
  for (const step of steps) {
    list.append(
      el('li', { class: 'op-cause', attrs: { 'data-step': step.id } }, [
        el('span', { class: 'op-cause__label', text: step.label }),
        el('strong', { text: step.title }),
        el('p', { text: step.body }),
      ]),
    );
  }
  return list;
}

function routeCard(model) {
  const card = el('article', { class: 'op-route-card' });
  const head = el('div', { class: 'op-card-head' }, [
    el('div', {}, [
      el('span', { class: 'op-kicker', text: model.finding?.id ?? 'Current route' }),
      el('h2', { text: model.finding?.title ?? 'No operating route is waiting' }),
    ]),
    statusPill(model.route?.state ?? model.finding?.status ?? 'quiet', 'primary'),
  ]);
  card.append(head);
  card.append(
    el('p', {
      class: 'op-route-card__proposal',
      text:
        model.finding?.proposal ??
        'This cycle is quiet. Keep observing the recorded outcomes and evidence freshness.',
    }),
  );
  const facts = el('dl', { class: 'op-facts' });
  for (const [label, value] of [
    ['Lane', model.finding?.lane ?? '—'],
    ['Owner', model.finding?.owner ?? '—'],
    ['Score', model.finding?.score ? `${model.finding.score} / 125` : '—'],
    ['Evidence', model.finding?.evidenceRefs?.join(', ') ?? '—'],
  ]) {
    facts.append(el('div', {}, [el('dt', { text: label }), el('dd', { text: value })]));
  }
  card.append(facts);
  if (model.specLink) {
    const link = el('a', {
      class: 'op-spec-link',
      text: `${model.specLink.specId} · ${model.specLink.state}`,
      attrs: {
        href: `#detail/${encodeURIComponent(model.specLink.specId)}`,
        'aria-label': `Open delivery spec ${model.specLink.specId}`,
      },
    });
    card.append(link);
  }
  card.append(cliHandoff(`planr operate review ${model.cycle?.id ?? ''}`.trim(), 'Review in CLI'));
  return card;
}

function governanceCard(model) {
  const card = el('section', { class: 'op-governance' }, [
    el('div', { class: 'op-card-head' }, [
      el('div', {}, [
        el('span', { class: 'op-kicker', text: 'Human authority' }),
        el('h2', { text: 'Decision and evidence gap' }),
      ]),
      statusPill(`${model.summary.openDecisions} open`, 'warning'),
    ]),
  ]);
  const rows = [
    {
      label: model.decision?.id ?? 'Decision',
      title: model.decision?.question ?? 'No decision is waiting',
      meta: model.decision?.deadline
        ? `Due ${new Date(model.decision.deadline).toLocaleString()}`
        : 'No deadline recorded',
    },
    {
      label: model.gap?.id ?? 'Evidence gap',
      title: model.gap?.question ?? 'No evidence gap is open',
      meta: model.gap?.reason ?? 'Every enabled lens met its recorded evidence bar.',
    },
  ];
  for (const row of rows) {
    card.append(
      el('div', { class: 'op-governance__row' }, [
        el('span', { class: 'op-kicker', text: row.label }),
        el('strong', { text: row.title }),
        el('p', { text: row.meta }),
      ]),
    );
  }
  card.append(
    cliHandoff(
      model.decision
        ? `planr operate decisions show ${model.decision.id}`
        : `planr operate gaps list`,
      'Inspect in CLI',
    ),
  );
  return card;
}

function lensBoard(model) {
  const section = el('section', { class: 'op-lenses' }, [
    el('div', { class: 'op-section-head' }, [
      el('div', {}, [
        el('span', { class: 'op-kicker', text: 'Independent advisory lenses' }),
        el('h2', { text: 'One board, six bounded perspectives' }),
      ]),
      el('p', { text: 'Advisors propose. The deterministic engine governs.' }),
    ]),
  ]);
  const grid = el('div', { class: 'op-lens-grid' });
  for (const lens of model.lenses) {
    const tone =
      lens.state === 'needs-evidence'
        ? 'warning'
        : lens.state === 'enabled'
          ? 'success'
          : 'neutral';
    grid.append(
      el('article', { class: 'op-lens' }, [
        el('div', { class: 'op-lens__mark', text: lens.label }),
        el('div', {}, [
          el('strong', { text: lens.label }),
          statusPill(lens.state.replace('-', ' '), tone),
        ]),
      ]),
    );
  }
  section.append(grid);
  return section;
}

function renderReady(root, state) {
  const model = deriveOperatingViewModel(state);
  const score = model.finding?.score ?? 0;
  root.append(
    el('div', { class: 'op-brief' }, [
      el('header', { class: 'op-hero' }, [
        el('div', {}, [
          el('p', {
            class: 'op-kicker',
            text: `${model.cycle?.id ?? 'No active cycle'} · ${model.cycle?.health ?? 'unknown'} health`,
          }),
          el('h1', {
            text:
              model.summary.currentConstraint ??
              (model.summary.quiet ? 'No material constraint surfaced' : 'Operating review'),
          }),
          el('p', {
            class: 'op-hero__copy',
            text:
              model.finding?.cost ??
              'A read-only projection of verified evidence, governed recommendations, and measured outcomes.',
          }),
        ]),
        el('div', { class: 'op-seal', attrs: { 'aria-label': `Priority score ${score} of 125` } }, [
          el('strong', { text: String(score) }),
          el('span', { text: 'priority / 125' }),
        ]),
      ]),
      el('section', { class: 'op-section' }, [
        el('div', { class: 'op-section-head' }, [
          el('div', {}, [
            el('span', { class: 'op-kicker', text: 'Causal thread' }),
            el('h2', { text: 'From observed evidence to measured outcome' }),
          ]),
          el('p', {
            class: 'op-event-head',
            text: `Event ${model.eventHead.sequence} · ${String(model.eventHead.hash ?? 'genesis').slice(0, 20)}…`,
          }),
        ]),
        renderCausalThread(model),
      ]),
      el('div', { class: 'op-grid' }, [routeCard(model), governanceCard(model)]),
      lensBoard(model),
      el('footer', { class: 'op-footer' }, [
        el('span', {
          text: `${model.priorCycles.length} prior cycle${model.priorCycles.length === 1 ? '' : 's'}`,
        }),
        el('span', {
          text: `${model.outcomes.length} outcome${model.outcomes.length === 1 ? '' : 's'} · ${model.learnings.length} learning${model.learnings.length === 1 ? '' : 's'}`,
        }),
        cliHandoff('planr operate status --json', 'Copy status command'),
      ]),
    ]),
  );
}

async function loadProjection({ refresh = false } = {}) {
  const cache = window.__dashboard?.operating;
  if (!refresh && cache) return cache;
  const response = await fetch('/api/operate', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Operating projection request failed (${response.status}).`);
  const projection = await response.json();
  if (window.__dashboard) window.__dashboard.operating = projection;
  return projection;
}

async function render(root, options = {}) {
  root.innerHTML = '';
  try {
    const projection = await loadProjection(options);
    if (projection.status === 'absent') {
      root.append(
        statePanel(
          'Start the first operating cycle',
          'No operating projection exists. Initialize the charter and evidence sources from the CLI.',
          'planr operate init',
        ),
      );
      return;
    }
    if (projection.status === 'stale' || projection.status === 'invalid') {
      root.append(
        statePanel(
          projection.status === 'stale' ? 'Projection needs recovery' : 'Projection is invalid',
          projection.recovery ?? projection.error ?? 'The dashboard will not repair operating state.',
          'planr operate integrity status',
          'warning',
        ),
      );
      return;
    }
    if (!projection.state) throw new Error('Operating projection did not include state.');
    renderReady(root, projection.state);
  } catch (error) {
    root.append(
      statePanel(
        'Operating state is unavailable',
        String(error?.message ?? error),
        'planr operate diagnostics export',
        'warning',
      ),
    );
  }
}

export async function mount(root) {
  mountedRoot = root;
  await render(root);
}

export async function partialRefresh() {
  if (mountedRoot) await render(mountedRoot, { refresh: true });
}
