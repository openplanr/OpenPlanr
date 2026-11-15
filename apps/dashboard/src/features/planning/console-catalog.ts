/**
 * Static catalog of the planr-* capabilities for the operator Console view.
 * Descriptions mirror the skill registry; `view` is a no-param dashboard hash
 * route (or null when a capability has no dashboard home). Reference only: the
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
  command: `/planr:${id.slice(6)}`,
});

export const PLANR_CAPABILITY_GROUPS: readonly PlanrCapabilityGroup[] = Object.freeze([
  {
    id: 'lifecycle',
    title: 'Plan & deliver',
    description: 'Shape intent into work, review it, implement it, and land it.',
    capabilities: Object.freeze([
      cap('planr-openplanr', 'Route a planning or delivery request to the right workflow.', null),
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
      cap(
        'planr-sprint',
        'Select a sprint against code, capacity, and the release cut.',
        '#/sprints',
      ),
      cap(
        'planr-delegate',
        'Coordinate an implementation with another coding agent and review its changes.',
        null,
      ),
      cap('planr-release', 'Choose versions and prepare user-facing release notes.', null),
      cap('planr-land', 'Assess release readiness and prepare a landing sequence.', '#/home'),
      cap(
        'planr-status',
        "Inspect project or one feature's delivery status without changing state.",
        '#/home',
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
      cap('planr-share', 'Share a local artifact through an explicit review workflow.', null),
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
        'planr-connect',
        'Inspect host connections and guide connecting a missing service.',
        null,
      ),
      cap('planr-dashboard', 'Start or inspect this loopback-only planning dashboard.', '#/home'),
    ]),
  },
]);

export type PlanrCommandGroup = Readonly<{
  id: string;
  title: string;
  description: string;
  commands: readonly PlanrCapability[];
}>;

export const CLI_COMMAND_GROUPS: readonly PlanrCommandGroup[] = Object.freeze([
  {
    id: 'planning-commands',
    title: 'Planning commands',
    description:
      'Replace placeholders with exact artifact identities. Run commands from the project folder.',
    commands: Object.freeze([
      {
        id: 'planning-status',
        summary: 'Read the parent specification status for a scoped task.',
        view: '#/list',
        command: 'openplanr status <spec-id> --md',
      },
      {
        id: 'backlog-show',
        summary: 'Read a backlog item before changing its status.',
        view: '#/list',
        command: 'openplanr backlog show <backlog-id>',
      },
      {
        id: 'backlog-update',
        summary: 'Update a backlog status explicitly in the CLI.',
        view: '#/list',
        command: 'openplanr backlog update <backlog-id> --status <status>',
      },
    ]),
  },
  {
    id: 'operate-commands',
    title: 'Operate commands',
    description:
      'Supplemental CLI templates. Existing ownership, preview, confirmation, and receipt checks still apply.',
    commands: Object.freeze([
      {
        id: 'operate-planning-preview',
        summary: 'Preview a planning handoff as the exact authorized Action owner.',
        view: '#/operate/actions',
        command: 'openplanr operate planning preview <action-id> --actor <actor-id>',
      },
      {
        id: 'operate-planning-create-spec',
        summary:
          'Create a specification using the exact proposal and confirmation digest from preview.',
        view: '#/operate/actions',
        command:
          'openplanr operate planning create-spec <proposal-id> --actor <actor-id> --confirm <preview-digest>',
      },
      {
        id: 'operate-review',
        summary: 'Read the latest Review and its exact choice identities before deciding.',
        view: '#/operate/cycles',
        command:
          'openplanr operate review <review-id> --actor <actor-id> --cycle <cycle-id> --scope <scope-id> --domain <domain-id> --domain-version <version>',
      },
      {
        id: 'operate-decide',
        summary:
          'Record an authorized decision using the choice identity and hash from the latest Review read.',
        view: '#/operate/cycles',
        command:
          'openplanr operate decide <review-id> --actor <actor-id> --cycle <cycle-id> --scope <scope-id> --domain <domain-id> --domain-version <version> --choice <choice-id> --choice-hash <choice-digest>',
      },
      {
        id: 'operate-assignment-submit',
        summary: 'Submit a validated result file for an exact issued Assignment packet.',
        view: '#/operate/cycles',
        command: 'openplanr operate assignment submit <packet-id> --content-file <result-path>',
      },
    ]),
  },
]);
