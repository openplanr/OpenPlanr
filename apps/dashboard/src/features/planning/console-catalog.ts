/**
 * Static catalog of the planr-* capabilities for the operator Console view.
 * Descriptions mirror the skill registry; `view` is a no-param dashboard hash
 * route (or null when a capability has no dashboard home). Reference only — the
 * Console never runs a capability or writes `.planr`.
 */

export type PlanrCapability = Readonly<{
  id: string;
  summary: string;
  view: string | null;
  command: string;
}>;

export type PlanrCapabilityGroup = Readonly<{
  id: string;
  title: string;
  description: string;
  capabilities: readonly PlanrCapability[];
}>;

const cap = (id: string, summary: string, view: string | null): PlanrCapability => ({
  id,
  summary,
  view,
  command: `/${id}`,
});

export const PLANR_CAPABILITY_GROUPS: readonly PlanrCapabilityGroup[] = Object.freeze([
  {
    id: 'lifecycle',
    title: 'Plan & deliver',
    description: 'Shape intent into work, review it, implement it, and land it.',
    capabilities: Object.freeze([
      cap(
        'planr-spec',
        'Shape vague intent into a measurable, Protocol-compatible specification.',
        '#/list',
      ),
      cap(
        'planr-plan',
        'Turn a specification or intent into schema-compatible stories and tasks.',
        '#/board',
      ),
      cap(
        'planr-plan-review',
        'Review a plan for product, engineering, design, and DX problems.',
        '#/board',
      ),
      cap(
        'planr-ship',
        'Implement a plan, specification, task, or clearly stated request.',
        '#/board',
      ),
      cap('planr-land', 'Assess release readiness and prepare a landing sequence.', '#/overview'),
      cap(
        'planr-status',
        "Inspect project or one feature's delivery status without changing state.",
        '#/overview',
      ),
    ]),
  },
  {
    id: 'operate',
    title: 'Operate',
    description: 'Run operating cycles and executive reviews over delivered work.',
    capabilities: Object.freeze([
      cap(
        'planr-operate',
        'Run a focused operating review across executive lenses and produce a board report.',
        '#/operate/today',
      ),
    ]),
  },
  {
    id: 'review-board',
    title: 'Executive review board',
    description: 'Grounded single-lens reviews and their synthesis for an Operate cycle.',
    capabilities: Object.freeze([
      cap(
        'planr-ceo-review',
        'Grounded strategy and finance review for an Operate cycle.',
        '#/operate/cycles',
      ),
      cap(
        'planr-cpo-review',
        'Grounded product and activation review for an Operate cycle.',
        '#/operate/cycles',
      ),
      cap(
        'planr-cto-review',
        'Grounded technology and delivery-risk review for an Operate cycle.',
        '#/operate/cycles',
      ),
      cap(
        'planr-cmo-review',
        'Grounded market and growth review for an Operate cycle.',
        '#/operate/cycles',
      ),
      cap(
        'planr-coo-review',
        'Grounded operations and customer-health review for an Operate cycle.',
        '#/operate/cycles',
      ),
      cap(
        'planr-challenger-review',
        "Challenge a cycle's claims, alternatives, downside, and confidence.",
        '#/operate/cycles',
      ),
      cap(
        'planr-chair-review',
        'Synthesize a cycle into a prioritized decision queue and action plan.',
        '#/operate/cycles',
      ),
    ]),
  },
  {
    id: 'design',
    title: 'Design & artifacts',
    description: 'Explore, review, and produce visual and document artifacts.',
    capabilities: Object.freeze([
      cap('planr-design', 'Create or route a product-design workflow using portable boards.', null),
      cap(
        'planr-design-loop',
        'Explore multiple design directions and collect pinned board feedback.',
        null,
      ),
      cap(
        'planr-design-review',
        'Review and revise an existing design from pinned board feedback.',
        null,
      ),
      cap(
        'planr-diagram',
        'Create, inspect, verify, or rerender professional offline diagrams.',
        null,
      ),
      cap('planr-artifact', 'Open, share, import, or export an HTML artifact review.', null),
    ]),
  },
  {
    id: 'maintain',
    title: 'Investigate & maintain',
    description: 'Diagnose problems, verify behavior, and keep planning state healthy.',
    capabilities: Object.freeze([
      cap(
        'planr-investigate',
        'Diagnose a bug, regression, or unexplained behavior, and optionally fix it.',
        null,
      ),
      cap(
        'planr-browser-qa',
        'Browser-backed QA over real routes, forms, viewports, accessibility, and network.',
        null,
      ),
      cap(
        'planr-doctor',
        'Diagnose CLI, pipeline, runtime-adapter, and installation problems.',
        '#/diagnostics',
      ),
      cap('planr-sync', 'Audit planning artifacts for graph and protocol drift.', '#/activity'),
      cap(
        'planr-dashboard',
        'Start or inspect this loopback-only planning dashboard.',
        '#/overview',
      ),
    ]),
  },
]);
