import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { buildOperatingIntegritySummary, renderOperatingIntegrityDocument } from './integrity.js';
import {
  applyJournalTransaction,
  type JournalWrite,
  prepareJournalTransaction,
} from './journal.js';
import {
  OPERATING_BOARD_ROLES,
  renderOperatingBoardReport,
  renderOperatingBrief,
  renderOperatingEvidenceIndex,
  selectCycleState,
} from './projection.js';
import { assertOperatingArtifact } from './protocol.js';
import { operatingStalledItems } from './stalled-item-service.js';
import { OperateError, type OperatingEventHead, type OperatingState } from './types.js';

const OPERATE_ROOT = '.planr/operate';
// Protocol v1.3 (FR6): the legacy `.planr/operate/projections/` directory —
// which duplicated the top-level register/decision/gap tree byte-for-byte and
// was the only home of the parked-findings backlog — is retired. `state.json`
// is the sole canonical projection that survives; it moves under the `.state/`
// internals beside `checkpoint.json`/`records.jsonl`/`events.jsonl`, and every
// readable register is now emitted exactly once at the top level.
const STATE_INTERNAL_ROOT = `${OPERATE_ROOT}/.state`;
const STATE_PATH = `${STATE_INTERNAL_ROOT}/state.json`;
const EVIDENCE_INDEX_PATH = `${OPERATE_ROOT}/evidence-index.json`;
// FR5/FR6 readable tree: one consolidated Markdown file per register rendered at
// the top level (the workspace path getters T-001 added), above the `.state/`
// internals. `backlog.md` (parked findings with their full parked reasons) is
// promoted here from the retired projections directory so parked intelligence
// has exactly one authoritative readable copy.
const READABLE_TREE_PROJECTIONS = [
  {
    relativePath: `${OPERATE_ROOT}/brief.md`,
    markerName: 'operate-brief',
    render: renderOperatingBrief,
  },
  {
    relativePath: `${OPERATE_ROOT}/findings.md`,
    markerName: 'operate-findings-register',
    render: renderFindingRegister,
  },
  {
    relativePath: `${OPERATE_ROOT}/decisions.md`,
    markerName: 'operate-decisions-register',
    render: renderDecisionRegister,
  },
  {
    relativePath: `${OPERATE_ROOT}/gaps.md`,
    markerName: 'operate-data-gaps-register',
    render: renderDataGapRegister,
  },
  {
    relativePath: `${OPERATE_ROOT}/routes.md`,
    markerName: 'operate-routes-register',
    render: renderRouteRegister,
  },
  {
    relativePath: `${OPERATE_ROOT}/backlog.md`,
    markerName: 'operate-backlog-register',
    render: renderBacklogRegister,
  },
] as const;
const CYCLE_BRIEF_MARKER = 'operate-cycle-brief';
const CYCLE_REPORT_MARKER = 'operate-cycle-report';
const CYCLE_INTEGRITY_MARKER = 'operate-cycle-integrity';
const BOARD_MARKER = 'operate-board';

export type OperatingProjectionDriftStatus = 'absent' | 'current' | 'drift';

export interface OperatingProjectionDrift {
  path: string;
  status: OperatingProjectionDriftStatus;
  expectedDigest: `sha256:${string}`;
  actualDigest: `sha256:${string}` | null;
  reason?: string;
}

export interface OperatingProjectionFile {
  relativePath: string;
  content: string;
  markerName?: string;
  managedContent?: string;
}

export interface OperatingProjectionPreview {
  stateDigest: `sha256:${string}`;
  eventHead: OperatingEventHead;
  previewDigest: `sha256:${string}`;
  files: OperatingProjectionFile[];
  changedPaths: string[];
  drift: OperatingProjectionDrift[];
}

export interface PersistOperatingProjectionResult extends OperatingProjectionPreview {
  transactionId: string | null;
}

function value(record: Record<string, unknown>, key: string, fallback = ''): string {
  const candidate = record[key];
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.replace(/\s+/g, ' ').trim();
  }
  if (typeof candidate === 'number' || typeof candidate === 'boolean') {
    return String(candidate);
  }
  return fallback;
}

function markdownCell(candidate: unknown, fallback = '—'): string {
  const rendered =
    typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean'
      ? String(candidate)
      : fallback;
  const withoutControls = [...rendered]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint >= 32 && codePoint !== 127)
      );
    })
    .join('');
  const normalized = withoutControls.replace(/\s+/g, ' ').trim();
  return (normalized || fallback).replaceAll('\\', '\\\\').replaceAll('|', '\\|');
}

function evidenceRefs(record: Record<string, unknown>): string {
  if (!Array.isArray(record.evidenceRefs)) return '—';
  const refs = [
    ...new Set(record.evidenceRefs.filter((entry): entry is string => typeof entry === 'string')),
  ].sort();
  return refs.length > 0 ? refs.map((entry) => `\`${markdownCell(entry)}\``).join(', ') : '—';
}

function generatedHeader(state: OperatingState, title: string): string[] {
  return [
    `# ${title}`,
    '',
    '> Generated by `planr operate` from canonical events. Edit operating state through the CLI.',
    `> Event head: ${state.eventHead.sequence} / ${state.eventHead.hash ?? 'genesis'}`,
    `> Projection time: ${state.generatedAt}`,
    '',
  ];
}

function renderFindingRegister(state: OperatingState): string {
  const findings = [...state.findings].sort((left, right) => left.id.localeCompare(right.id));
  const stalledById = new Map(
    operatingStalledItems(state).map((item) => [item.id, item.stalledCycles]),
  );
  return [
    ...generatedHeader(state, 'Operating Findings Register'),
    '| Finding | Status | Lane | Owner | Severity | Score | Stalled cycles | Title | Evidence |',
    '|---|---|---|---|---|---:|---:|---|---|',
    ...(findings.length > 0
      ? findings.map(
          (finding) =>
            `| ${markdownCell(finding.id)} | ${markdownCell(finding.status)} | ${markdownCell(
              finding.lane,
            )} | ${markdownCell(finding.owner)} | ${markdownCell(
              finding.severity,
            )} | ${markdownCell(finding.score, '0')} | ${markdownCell(
              stalledById.get(finding.id) ?? 0,
              '0',
            )} | ${markdownCell(finding.title)} | ${evidenceRefs(finding)} |`,
        )
      : ['| — | — | — | — | — | 0 | 0 | No findings recorded. | — |']),
  ].join('\n');
}

function renderDecisionRegister(state: OperatingState): string {
  const stalledById = new Map(
    operatingStalledItems(state).map((item) => [item.id, item.stalledCycles]),
  );
  const decisions = [...state.decisions].sort((left, right) => {
    const deadlineDelta = value(left, 'deadline').localeCompare(value(right, 'deadline'));
    return deadlineDelta || left.id.localeCompare(right.id);
  });
  return [
    ...generatedHeader(state, 'Operating Decisions'),
    '| Decision | Status | Owner | Deadline | Stalled cycles | Reversibility | Question | Recommendation |',
    '|---|---|---|---|---:|---|---|---|',
    ...(decisions.length > 0
      ? decisions.map(
          (decision) =>
            `| ${markdownCell(decision.id)} | ${markdownCell(
              decision.status,
            )} | ${markdownCell(decision.owner)} | ${markdownCell(
              decision.deadline,
            )} | ${markdownCell(stalledById.get(decision.id) ?? 0, '0')} | ${markdownCell(
              decision.reversibility,
            )} | ${markdownCell(decision.question)} | ${markdownCell(decision.recommendation)} |`,
        )
      : ['| — | — | — | — | 0 | — | No decisions recorded. | — |']),
  ].join('\n');
}

function renderDataGapRegister(state: OperatingState): string {
  const gaps = [...state.dataGaps].sort((left, right) => left.id.localeCompare(right.id));
  return [
    ...generatedHeader(state, 'Operating Data Gaps'),
    '| Gap | Status | Owner | Question | Reason | Unblocks |',
    '|---|---|---|---|---|---|',
    ...(gaps.length > 0
      ? gaps.map((gap) => {
          const unblocks = Array.isArray(gap.unblocks)
            ? gap.unblocks
                .filter((entry): entry is string => typeof entry === 'string')
                .sort()
                .join(', ')
            : '';
          return `| ${markdownCell(gap.id)} | ${markdownCell(
            gap.status,
          )} | ${markdownCell(gap.owner)} | ${markdownCell(
            gap.question,
          )} | ${markdownCell(gap.reason)} | ${markdownCell(unblocks)} |`;
        })
      : ['| — | — | — | No data gaps recorded. | — | — |']),
  ].join('\n');
}

function renderBacklogRegister(state: OperatingState): string {
  const parked = state.findings
    .filter((finding) => finding.parked === true)
    .sort((left, right) => {
      const scoreDelta = Number(right.score ?? 0) - Number(left.score ?? 0);
      return scoreDelta || left.id.localeCompare(right.id);
    });
  return [
    ...generatedHeader(state, 'Operating Backlog'),
    '| Finding | Status | Owner | Score | Title | Parked reason | Evidence |',
    '|---|---|---|---:|---|---|---|',
    ...(parked.length > 0
      ? parked.map(
          (finding) =>
            `| ${markdownCell(finding.id)} | ${markdownCell(
              finding.status,
            )} | ${markdownCell(finding.owner)} | ${markdownCell(
              finding.score,
              '0',
            )} | ${markdownCell(finding.title)} | ${markdownCell(
              finding.problem ?? finding.proposal,
              'Deprioritized by the current attention cap.',
            )} | ${evidenceRefs(finding)} |`,
        )
      : ['| — | — | — | 0 | No parked findings. | — | — |']),
  ].join('\n');
}

function renderRouteRegister(state: OperatingState): string {
  const routes = [...state.routes].sort((left, right) => left.id.localeCompare(right.id));
  return [
    ...generatedHeader(state, 'Operating Routes'),
    '| Route | Cycle | State | Findings | Actions | Route digest |',
    '|---|---|---|---|---:|---|',
    ...(routes.length > 0
      ? routes.map((route) => {
          const actions = Array.isArray(route.actions)
            ? (route.actions as Array<{ findingId?: unknown }>)
            : [];
          const findingIds = Array.isArray(route.findingIds)
            ? route.findingIds.filter((entry): entry is string => typeof entry === 'string')
            : [
                ...new Set(
                  actions
                    .map((action) => action.findingId)
                    .filter((entry): entry is string => typeof entry === 'string'),
                ),
              ];
          const actionCount =
            typeof route.actionCount === 'number' ? route.actionCount : actions.length;
          return `| ${markdownCell(route.id)} | ${markdownCell(route.cycleId)} | ${markdownCell(
            route.state,
          )} | ${markdownCell(findingIds.sort().join(', '))} | ${markdownCell(
            actionCount,
            '0',
          )} | ${markdownCell(route.routeDigest)} |`;
        })
      : ['| — | — | — | — | 0 | No routes recorded. |']),
  ].join('\n');
}

function renderCycleBrief(state: OperatingState, cycleId: string): string {
  const selected = selectCycleState(state, cycleId);
  const brief = renderOperatingBrief(selected);
  const words = brief.split(/\s+/).filter(Boolean);
  if (words.length > 900) {
    throw new OperateError(
      'E_OPERATE_PROJECTION_DRIFT',
      `Cycle brief ${cycleId} exceeds the 900-word projection limit.`,
      { cycleId, words: words.length },
    );
  }
  return brief;
}

function markerExpression(markerName: string, edge: 'begin' | 'end'): RegExp {
  const escaped = markerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return edge === 'begin'
    ? new RegExp(`^<!--\\s*##planr-${escaped}:begin##[^>]*-->[\\t ]*(?:\\r?\\n|$)`, 'gm')
    : new RegExp(`^<!--\\s*##planr-${escaped}:end##\\s*-->[\\t ]*`, 'gm');
}

function managedSection(
  content: string,
  markerName: string,
): { content: string; malformed: boolean } | null {
  const beginMatches = [...content.matchAll(markerExpression(markerName, 'begin'))];
  const endMatches = [...content.matchAll(markerExpression(markerName, 'end'))];
  if (beginMatches.length === 0 && endMatches.length === 0) return null;
  if (beginMatches.length !== 1 || endMatches.length !== 1) {
    return { content: '', malformed: true };
  }
  const begin = beginMatches[0];
  const end = endMatches[0];
  const beginEnd = (begin.index ?? 0) + begin[0].length;
  const endStart = end.index ?? 0;
  if (endStart < beginEnd) return { content: '', malformed: true };
  return {
    content: content.slice(beginEnd, endStart).trimEnd(),
    malformed: false,
  };
}

function beginMarker(markerName: string): string {
  return `<!-- ##planr-${markerName}:begin## (managed by planr CLI; preserve hand-edits outside this block) -->`;
}

function endMarker(markerName: string): string {
  return `<!-- ##planr-${markerName}:end## -->`;
}

function spliceProjectionBlock(
  existing: string,
  markerName: string,
  managedContent: string,
): string {
  const beginMatches = [...existing.matchAll(markerExpression(markerName, 'begin'))];
  const endMatches = [...existing.matchAll(markerExpression(markerName, 'end'))];
  const block = [beginMarker(markerName), managedContent.trimEnd(), endMarker(markerName)].join(
    '\n',
  );
  if (beginMatches.length === 0 && endMatches.length === 0) {
    if (existing.length === 0) return `${block}\n`;
    const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return `${existing}${separator}${block}\n`;
  }
  if (beginMatches.length !== 1 || endMatches.length !== 1) {
    throw new OperateError(
      'E_OPERATE_PROJECTION_DRIFT',
      `Projection markers for ${markerName} are malformed or duplicated.`,
      { markerName },
    );
  }
  const begin = beginMatches[0];
  const end = endMatches[0];
  const beginStart = begin.index ?? 0;
  const endStart = end.index ?? 0;
  if (endStart < beginStart + begin[0].length) {
    throw new OperateError(
      'E_OPERATE_PROJECTION_DRIFT',
      `Projection markers for ${markerName} are out of order.`,
      { markerName },
    );
  }
  const afterStart = endStart + end[0].length;
  return `${existing.slice(0, beginStart)}${block}${existing.slice(afterStart)}`;
}

/**
 * The rich, event-log-derived board/report content for one governed cycle.
 * `reportMarkdown` is the full `readOperatingReport({cycleId}).markdown`;
 * `boardByRole` holds each role's `markdownLens` output (the exact per-role
 * Markdown `planr operate report <cycleId> --lens <role>` emits); and
 * `evaluatedRoleIds` names the roles that actually produced an advisor-result
 * record — the source of truth for a board's `Status:` line (FR1).
 */
export interface OperatingRichCycleArtifact {
  reportMarkdown: string;
  /** Added in Protocol v1.4; optional while replaying v1.2/v1.3 fixtures. */
  reportJson?: string;
  /** Added in Protocol v1.4; optional while replaying v1.2/v1.3 fixtures. */
  actionsMarkdown?: string;
  boardByRole: ReadonlyMap<string, string>;
  evaluatedRoleIds: ReadonlySet<string>;
}

const OPERATING_ROLE_FILE_ALIASES = new Map<string, string>([
  ['strategy-finance', 'ceo'],
  ['technology-risk', 'cto'],
  ['product-activation', 'cpo'],
  ['growth-market', 'cmo'],
  ['operations-customer', 'coo'],
  ['chair', 'chair'],
]);

function renderAgenticActionsMarkdown(
  cycleId: string,
  reports: ReadonlyArray<{ roleId: string; actions?: Array<Record<string, unknown>> }>,
): string {
  const actions = reports.flatMap((report) =>
    (report.actions ?? []).map((action) => ({
      roleId: report.roleId,
      lane: action.lane,
      title: action.title,
      actionKey: action.actionKey,
      summary: action.summary,
    })),
  );
  return [
    `# ${cycleId} proposed actions`,
    '',
    '> Generated by `planr operate` from validated Protocol v1.4 advisor reports.',
    '> These are proposals. They do not accept findings, approve drafts, invoke PLAN, or invoke SHIP.',
    '',
    ...(actions.length > 0
      ? actions.map(
          (action) =>
            `- **${String(action.lane ?? 'OWNER')} · ${String(action.title ?? action.actionKey ?? 'Proposed action')}** (${String(action.roleId)}) — ${String(action.summary ?? '')}`,
        )
      : ['- No citation-qualified actions were produced.']),
  ].join('\n');
}

/**
 * Re-read the committed event log to assemble the rich board/report content for
 * every reviewable/closed cycle. The persisted `report.md`/`board/<role>.md`
 * files must be the same scored, cited analysis the transient `review`/`report`
 * commands render — not the cheap state-only projection — so persistence and
 * drift-inspection both derive them here from the one `readOperatingReport`
 * assembly (FR1). Determinism from the immutable event log guarantees the
 * inspect re-render reproduces the persisted bytes.
 */
export async function readOperatingRichCycleArtifacts(input: {
  projectRoot: string;
  state: OperatingState;
  localRoot?: string;
}): Promise<Map<string, OperatingRichCycleArtifact>> {
  const artifacts = new Map<string, OperatingRichCycleArtifact>();
  // FR4 (SPEC-005): a still-advising (or consolidating/blocked) cycle materializes
  // its readable artifacts too, so every validated lens is inspectable BEFORE
  // Chair finalizes — not only once the cycle reaches `reviewable`. An in-flight
  // cycle is only included once it actually has committed advisor results (guarded
  // below on `evaluatedRoleIds`), so the pre-record advising handoff still writes
  // no empty cycle directory.
  const TERMINAL_CYCLE_STATES = new Set(['reviewable', 'closed']);
  const cycles = input.state.cycles.filter(
    (cycle) =>
      TERMINAL_CYCLE_STATES.has(cycle.state) ||
      ['advising', 'consolidating', 'blocked'].includes(cycle.state),
  );
  if (cycles.length === 0) return artifacts;
  const { readOperatingReport, markdownLens, markdownCompleteRegisters } = await import(
    './reports.js'
  );
  const { listOperatingDrafts } = await import('./drafts.js');
  const drafts = await listOperatingDrafts(input.projectRoot).catch(() => []);
  for (const cycle of cycles) {
    try {
      const report = await readOperatingReport({
        projectRoot: input.projectRoot,
        cycleId: cycle.id,
        lens: 'all',
        localRoot: input.localRoot,
      });
      const cycleDrafts = drafts
        .filter((entry) => entry.draft.cycleId === cycle.id)
        .map((entry) => entry.draft)
        .sort((left, right) => left.draftId.localeCompare(right.draftId));
      const draftSection = [
        '# Provisional drafts',
        '',
        ...(cycleDrafts.length > 0
          ? cycleDrafts.map(
              (draft) =>
                `- **${draft.draftId}** [${draft.status} · ${draft.artifactKind}] \`${draft.path}\``,
            )
          : ['- No citation-qualified provisional drafts were materialized.']),
      ].join('\n');
      const evaluatedRoleIds = new Set(
        report.reports
          .filter((entry) => entry.outcome !== 'not_evaluated')
          .map((entry) => entry.roleId),
      );
      // An in-flight cycle earns a persisted artifact only once at least one lens
      // has actually recorded (FR4); before that, its report is entirely
      // not-evaluated and would write an empty cycle directory. A reviewable/closed
      // cycle always materializes, exactly as before.
      if (!TERMINAL_CYCLE_STATES.has(cycle.state) && evaluatedRoleIds.size === 0) {
        continue;
      }
      artifacts.set(cycle.id, {
        // FR8: the persisted `report.md` is self-contained — the concise brief +
        // lens reports + integrity section, then the complete uncapped registers.
        // The CLI's own `operate report` keeps rendering the capped brief; only
        // the on-disk artifact appends every finding/decision/gap/route.
        reportMarkdown: `${report.markdown}\n\n${draftSection}\n\n${markdownCompleteRegisters(
          selectCycleState(input.state, cycle.id),
        )}`,
        reportJson: `${canonicalize({
          kind: 'operating-cycle-report',
          schemaVersion: '1.0.0',
          protocolVersion: '1.4.0',
          cycleId: cycle.id,
          brief: report.brief,
          roles: report.reports,
          drafts: cycleDrafts,
          nextActions: report.actions,
        })}\n`,
        actionsMarkdown: `${renderAgenticActionsMarkdown(cycle.id, report.reports)}\n\n${draftSection}`,
        boardByRole: new Map(report.reports.map((entry) => [entry.roleId, markdownLens(entry)])),
        evaluatedRoleIds,
      });
    } catch {
      // The rich assembly re-reads the committed event log. If a cycle's records
      // cannot be re-read (for example a hand-built state with no backing event
      // store), skip its artifact: `report.md` is omitted and each
      // `board/<role>.md` falls back to the honest not-evaluated state renderer
      // rather than fabricating scored analysis it cannot source.
    }
  }
  return artifacts;
}

function markdownProjectionSpecs(
  state: OperatingState,
  richArtifacts: ReadonlyMap<string, OperatingRichCycleArtifact>,
): Array<{
  relativePath: string;
  markerName: string;
  managedContent: string;
}> {
  const registers = READABLE_TREE_PROJECTIONS.map((projection) => ({
    relativePath: projection.relativePath,
    markerName: projection.markerName,
    managedContent: projection.render(state),
  }));
  const cycleArtifacts = [...state.cycles]
    // FR4 (SPEC-005): a reviewable/closed cycle always materializes; an in-flight
    // cycle materializes once it has a rich artifact (i.e. at least one lens has
    // recorded), so partial validated progress is on disk before Chair runs.
    .filter(
      (cycle) =>
        cycle.state === 'reviewable' || cycle.state === 'closed' || richArtifacts.has(cycle.id),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((cycle) => {
      const rich = richArtifacts.get(cycle.id);
      // FR7: cycle integrity is rendered to its OWN readable-tree file, derived
      // from the cycle's governed gaps, so the signal survives independently of
      // the report and of any lens's prose. A clean cycle writes no integrity
      // file, keeping the tree free of empty artifacts.
      const integrity = buildOperatingIntegritySummary(selectCycleState(state, cycle.id), cycle.id);
      return [
        {
          relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/brief.md`,
          markerName: CYCLE_BRIEF_MARKER,
          managedContent: renderCycleBrief(state, cycle.id),
        },
        ...(integrity.hasConcerns
          ? [
              {
                relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/integrity.md`,
                markerName: CYCLE_INTEGRITY_MARKER,
                managedContent: renderOperatingIntegrityDocument(integrity),
              },
            ]
          : []),
        // The full, uncapped lens report — byte-identical to
        // `readOperatingReport({cycleId}).markdown`. Emitted only when the rich
        // assembly is available; the 900-word cap `renderCycleBrief` enforces on
        // `brief.md` is deliberately NOT applied to `report.md`.
        ...(rich
          ? [
              {
                relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/report.md`,
                markerName: CYCLE_REPORT_MARKER,
                managedContent: rich.reportMarkdown,
              },
              {
                relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/actions.md`,
                markerName: 'operate-cycle-actions',
                managedContent: rich.actionsMarkdown ?? renderAgenticActionsMarkdown(cycle.id, []),
              },
            ]
          : []),
        ...OPERATING_BOARD_ROLES.map((role) => ({
          relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/board/${role.id}.md`,
          markerName: BOARD_MARKER,
          // Rich per-role lens Markdown (identical to `report --lens <role>`)
          // when the advisor-result records are readable; otherwise the honest
          // state-only renderer whose `Status:` derives from the absence of an
          // advisor-result record, never from `enabledRoles`.
          managedContent:
            rich?.boardByRole.get(role.id) ??
            renderOperatingBoardReport(state, cycle.id, role, rich?.evaluatedRoleIds ?? new Set()),
        })),
        ...(rich
          ? OPERATING_BOARD_ROLES.filter(
              (role) => (OPERATING_ROLE_FILE_ALIASES.get(role.id) ?? role.id) !== role.id,
            ).map((role) => ({
              relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/board/${
                OPERATING_ROLE_FILE_ALIASES.get(role.id) ?? role.id
              }.md`,
              markerName: BOARD_MARKER,
              managedContent:
                rich.boardByRole.get(role.id) ??
                renderOperatingBoardReport(state, cycle.id, role, rich.evaluatedRoleIds),
            }))
          : []),
      ];
    });
  return [...registers, ...cycleArtifacts];
}

export function renderOperatingProjectionFiles(
  state: OperatingState,
  richArtifacts: ReadonlyMap<string, OperatingRichCycleArtifact> = new Map(),
): OperatingProjectionFile[] {
  const stateFile: OperatingProjectionFile = {
    relativePath: STATE_PATH,
    content: `${canonicalize(state)}\n`,
  };
  const evidenceIndexFile: OperatingProjectionFile = {
    relativePath: EVIDENCE_INDEX_PATH,
    content: renderOperatingEvidenceIndex(state),
  };
  const markdownFiles = markdownProjectionSpecs(state, richArtifacts).map((projection) => ({
    relativePath: projection.relativePath,
    markerName: projection.markerName,
    managedContent: projection.managedContent,
    content: spliceProjectionBlock('', projection.markerName, projection.managedContent),
  }));
  const reportJsonFiles = [...state.cycles]
    .filter((cycle) => cycle.state === 'reviewable' || cycle.state === 'closed')
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((cycle) => {
      const rich = richArtifacts.get(cycle.id);
      return rich?.reportJson
        ? [
            {
              relativePath: `${OPERATE_ROOT}/cycles/${cycle.id}/report.json`,
              content: rich.reportJson,
            },
          ]
        : [];
    });
  return [stateFile, evidenceIndexFile, ...markdownFiles, ...reportJsonFiles];
}

async function inspectProjectionFile(
  projectRoot: string,
  expected: OperatingProjectionFile,
): Promise<OperatingProjectionDrift> {
  const expectedBytes = expected.markerName ? (expected.managedContent ?? '') : expected.content;
  const expectedDigest = sha256Digest(expectedBytes);
  const current = await readFile(path.join(projectRoot, expected.relativePath), 'utf8').catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    },
  );
  if (current === null) {
    return {
      path: expected.relativePath,
      status: 'absent',
      expectedDigest,
      actualDigest: null,
      reason: 'Projection has not been generated.',
    };
  }
  if (!expected.markerName) {
    const actualDigest = sha256Digest(current);
    return actualDigest === expectedDigest
      ? { path: expected.relativePath, status: 'current', expectedDigest, actualDigest }
      : {
          path: expected.relativePath,
          status: 'drift',
          expectedDigest,
          actualDigest,
          reason: 'Canonical JSON bytes differ from event replay.',
        };
  }
  const section = managedSection(current, expected.markerName);
  if (!section) {
    return {
      path: expected.relativePath,
      status: 'drift',
      expectedDigest,
      actualDigest: sha256Digest(current),
      reason: 'Managed projection markers are missing.',
    };
  }
  if (section.malformed) {
    return {
      path: expected.relativePath,
      status: 'drift',
      expectedDigest,
      actualDigest: sha256Digest(current),
      reason: 'Managed projection markers are malformed or duplicated.',
    };
  }
  const actualDigest = sha256Digest(section.content);
  return actualDigest === expectedDigest
    ? { path: expected.relativePath, status: 'current', expectedDigest, actualDigest }
    : {
        path: expected.relativePath,
        status: 'drift',
        expectedDigest,
        actualDigest,
        reason: 'Generated projection rows differ from event replay.',
      };
}

export async function inspectOperatingProjectionDrift(input: {
  projectRoot: string;
  state: OperatingState;
  localRoot?: string;
  richCycleArtifacts?: ReadonlyMap<string, OperatingRichCycleArtifact>;
}): Promise<OperatingProjectionDrift[]> {
  await assertOperatingArtifact('operating-state', input.state);
  const richArtifacts =
    input.richCycleArtifacts ??
    (await readOperatingRichCycleArtifacts({
      projectRoot: input.projectRoot,
      state: input.state,
      localRoot: input.localRoot,
    }));
  const expected = renderOperatingProjectionFiles(input.state, richArtifacts);
  return Promise.all(expected.map((file) => inspectProjectionFile(input.projectRoot, file)));
}

export async function assertOperatingProjectionsCurrent(input: {
  projectRoot: string;
  state: OperatingState;
  localRoot?: string;
}): Promise<void> {
  const drift = await inspectOperatingProjectionDrift(input);
  const mismatches = drift.filter((entry) => entry.status !== 'current');
  if (mismatches.length > 0) {
    throw new OperateError(
      'E_OPERATE_PROJECTION_DRIFT',
      `${mismatches.length} Operating Board projection(s) differ from event replay.`,
      { projections: mismatches },
    );
  }
}

export async function prepareOperatingProjectionPersistence(input: {
  projectRoot: string;
  state: OperatingState;
  localRoot?: string;
}): Promise<OperatingProjectionPreview> {
  await assertOperatingArtifact('operating-state', input.state);
  // Assemble the rich board/report content once and thread the same map into
  // both the rendered files and the drift inspection below, so a single persist
  // can never write bytes the drift check would then flag as stale.
  const richArtifacts = await readOperatingRichCycleArtifacts({
    projectRoot: input.projectRoot,
    state: input.state,
    localRoot: input.localRoot,
  });
  const rendered = renderOperatingProjectionFiles(input.state, richArtifacts);
  const files: OperatingProjectionFile[] = [];
  for (const file of rendered) {
    if (!file.markerName) {
      files.push(file);
      continue;
    }
    const current = await readFile(path.join(input.projectRoot, file.relativePath), 'utf8').catch(
      (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      },
    );
    files.push({
      ...file,
      content: spliceProjectionBlock(current, file.markerName, file.managedContent ?? ''),
    });
  }
  const changedPaths: string[] = [];
  for (const file of files) {
    const current = await readFile(path.join(input.projectRoot, file.relativePath)).catch(
      (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      },
    );
    if (current === null || sha256Digest(current) !== sha256Digest(file.content)) {
      changedPaths.push(file.relativePath);
    }
  }
  const drift = await inspectOperatingProjectionDrift({
    ...input,
    richCycleArtifacts: richArtifacts,
  });
  const stateDigest = canonicalDigest(input.state);
  const previewDigest = canonicalDigest({
    kind: 'operating-projection-preview',
    stateDigest,
    eventHead: input.state.eventHead,
    writes: files
      .filter((file) => changedPaths.includes(file.relativePath))
      .map((file) => ({
        path: file.relativePath,
        digest: sha256Digest(file.content),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
  return {
    stateDigest,
    eventHead: structuredClone(input.state.eventHead),
    previewDigest,
    files,
    changedPaths,
    drift,
  };
}

export async function persistOperatingProjections(input: {
  projectRoot: string;
  state: OperatingState;
  localRoot?: string;
  transactionId?: string;
  now?: string;
  revalidateEventHead?: () => Promise<OperatingEventHead>;
}): Promise<PersistOperatingProjectionResult> {
  const preview = await prepareOperatingProjectionPersistence(input);
  if (preview.changedPaths.length === 0) {
    return { ...preview, transactionId: null };
  }
  const changed = new Set(preview.changedPaths);
  const writes: JournalWrite[] = preview.files
    .filter((file) => changed.has(file.relativePath))
    .map((file) => ({
      relativePath: file.relativePath,
      content: file.content,
      mode: '0600',
    }));
  const transaction = await prepareJournalTransaction(input.projectRoot, {
    writes,
    eventHead: preview.eventHead,
    previewDigest: preview.previewDigest,
    localRoot: input.localRoot,
    transactionId: input.transactionId,
    now: input.now,
  });
  await applyJournalTransaction(input.projectRoot, transaction, {
    currentEventHead: preview.eventHead,
    revalidateEventHead: input.revalidateEventHead,
  });
  return {
    ...preview,
    transactionId: transaction.record.transactionId,
  };
}

export const OPERATING_PROJECTION_PATHS = {
  // The sole surviving canonical projection, relocated under `.state/` now that
  // the legacy `projections/` directory is retired (FR6).
  state: STATE_PATH,
  evidenceIndex: EVIDENCE_INDEX_PATH,
  // The one authoritative readable copy of every register, at the top level.
  brief: `${OPERATE_ROOT}/brief.md`,
  findings: `${OPERATE_ROOT}/findings.md`,
  decisions: `${OPERATE_ROOT}/decisions.md`,
  gaps: `${OPERATE_ROOT}/gaps.md`,
  routes: `${OPERATE_ROOT}/routes.md`,
  backlog: `${OPERATE_ROOT}/backlog.md`,
} as const;
