import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { ParsedDashboardRoute } from '../../../app/router.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineAlert,
  PcIcon,
  type PcIconName,
  SectionHeader,
  SkeletonCards,
} from '../../../design-system/components/index.js';
import './local-operate-reviews.css';

type ReviewCounts = Readonly<{ decisions: number; actions: number; gaps: number; issues: number }>;
type LocalReviewSummary = Readonly<{
  cycleId: string;
  title: string;
  summary: string;
  signal: string;
  updatedAt: string;
  counts: ReviewCounts;
  href: string;
}>;
type Decision = Readonly<{
  id: string;
  priority: string;
  title: string;
  recommendation: string;
  whyNow: string;
  owner: string;
  confidence: string;
  firstStep: string;
  expectedResult: string;
  check: string;
  dependencies: string;
  revisitWhen: string;
  sources: string;
  dissent: string;
}>;
type Action = Readonly<{
  id: string;
  priority: string;
  action: string;
  owner: string;
  firstStep: string;
  successMeasure: string;
  check: string;
  dependencies: string;
  state: 'proposed' | 'needs-owner';
}>;
type NamedItem = Readonly<{ id: string; title: string; detail: string }>;
type Lens = Readonly<{
  name: string;
  filename: string;
  present: boolean;
  outcome: string;
  signal: string;
  informed: string;
  findings: number;
  recommendation: string;
}>;
type Evidence = Readonly<{
  id: string;
  reference: string;
  kind: string;
  freshness: string;
}>;
type Recovery = Readonly<{
  complete: boolean;
  presentFiles: readonly string[];
  missingFiles: readonly string[];
  totalBytes: number;
  custody: string;
}>;
type LocalReviewItem = LocalReviewSummary &
  Readonly<{
    scope: Readonly<{
      subject: string;
      window: string;
      requestedDecision: string;
      custody: string;
    }>;
    decisions: readonly Decision[];
    actions: readonly Action[];
    gaps: readonly NamedItem[];
    risks: readonly NamedItem[];
    issues: readonly NamedItem[];
    lenses: readonly Lens[];
    evidence: readonly Evidence[];
    recovery: Recovery;
    markdown: string;
  }>;
type LocalReviewIndex = Readonly<{
  kind: 'local-operate-review-index';
  schemaVersion: '1.0.0';
  readOnly: true;
  pagination: Readonly<{ page: number; pageSize: number; pageCount: number; total: number }>;
  items: readonly LocalReviewSummary[];
}>;
type LocalReviewDetail = Readonly<{
  kind: 'local-operate-review';
  schemaVersion: '1.0.0';
  readOnly: true;
  item: LocalReviewItem;
}>;

type LoadState<T> =
  | Readonly<{ status: 'loading'; data: T | null; error: null }>
  | Readonly<{ status: 'ready'; data: T; error: null }>
  | Readonly<{ status: 'failed'; data: T | null; error: string }>;

const EMPTY_INDEX: LocalReviewIndex = Object.freeze({
  kind: 'local-operate-review-index',
  schemaVersion: '1.0.0',
  readOnly: true,
  pagination: Object.freeze({ page: 1, pageSize: 12, pageCount: 1, total: 0 }),
  items: Object.freeze([]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof value[field] === 'string');
}

function localReviewSummary(value: unknown): value is LocalReviewSummary {
  if (!isRecord(value) || !isRecord(value.counts)) return false;
  const counts = value.counts;
  return (
    stringFields(value, ['cycleId', 'title', 'summary', 'signal', 'updatedAt', 'href']) &&
    ['decisions', 'actions', 'gaps', 'issues'].every((key) => Number.isSafeInteger(counts[key]))
  );
}

function parseIndex(value: unknown): LocalReviewIndex {
  if (
    !isRecord(value) ||
    value.kind !== 'local-operate-review-index' ||
    value.schemaVersion !== '1.0.0' ||
    value.readOnly !== true ||
    !isRecord(value.pagination) ||
    !Array.isArray(value.items) ||
    !value.items.every(localReviewSummary)
  ) {
    throw new Error('OpenPlanr returned an invalid local review index.');
  }
  if (
    !['page', 'pageSize', 'pageCount', 'total'].every((key) =>
      Number.isSafeInteger((value.pagination as Record<string, unknown>)[key]),
    )
  ) {
    throw new Error('OpenPlanr returned invalid local review pagination.');
  }
  return value as unknown as LocalReviewIndex;
}

function parseDetail(value: unknown): LocalReviewDetail {
  const item: Record<string, unknown> | null =
    isRecord(value) && isRecord(value.item) ? value.item : null;
  const listFields = ['decisions', 'actions', 'gaps', 'risks', 'issues', 'lenses', 'evidence'];
  const hasStructuredFields =
    item !== null &&
    typeof item.markdown === 'string' &&
    isRecord(item.scope) &&
    isRecord(item.recovery) &&
    listFields.every((field) => Array.isArray(item[field]));
  if (
    !isRecord(value) ||
    value.kind !== 'local-operate-review' ||
    value.schemaVersion !== '1.0.0' ||
    value.readOnly !== true ||
    !item ||
    !hasStructuredFields ||
    !localReviewSummary(item)
  ) {
    throw new Error('OpenPlanr returned an invalid local review.');
  }
  return value as unknown as LocalReviewDetail;
}

async function loadJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`OpenPlanr could not read this report (${response.status}).`);
  return response.json();
}

function useLocalReviewIndex(origin: string, page: number): LoadState<LocalReviewIndex> {
  const [state, setState] = useState<LoadState<LocalReviewIndex>>({
    status: 'loading',
    data: null,
    error: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const read = async () => {
      try {
        const url = new URL('/api/operate/local-reviews', origin);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', '12');
        const data = parseIndex(await loadJson(url, controller.signal));
        if (active) setState({ status: 'ready', data, error: null });
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setState((prior) => ({
            status: 'failed',
            data: prior.data,
            error: error instanceof Error ? error.message : 'Review index unavailable.',
          }));
        }
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 2_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [origin, page]);
  return state;
}

function useLocalReviewDetail(
  origin: string,
  cycleId: string | null,
): LoadState<LocalReviewDetail> {
  const [state, setState] = useState<LoadState<LocalReviewDetail>>({
    status: 'loading',
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!cycleId) {
      setState({ status: 'loading', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    const read = async () => {
      try {
        const url = new URL(`/api/operate/local-reviews/${encodeURIComponent(cycleId)}`, origin);
        const data = parseDetail(await loadJson(url, controller.signal));
        if (active) setState({ status: 'ready', data, error: null });
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setState((prior) => ({
            status: 'failed',
            data: prior.data,
            error: error instanceof Error ? error.message : 'Review unavailable.',
          }));
        }
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 2_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [cycleId, origin]);
  return state;
}

function readableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Updated recently';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

function withStableKeys<T>(values: readonly T[], serialize: (value: T) => string) {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const serialized = serialize(value);
    const occurrence = (seen.get(serialized) ?? 0) + 1;
    seen.set(serialized, occurrence);
    return Object.freeze({ key: `${serialized}:${occurrence}`, value });
  });
}

function InlineMarkdown({ text }: Readonly<{ text: string }>) {
  const parts = withStableKeys(text.split(/(\*\*[^*]+\*\*|`[^`]+`)/gu), (part) => part);
  return (
    <>
      {parts.map(({ key, value: part }) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={key}>{part.slice(1, -1)}</code>;
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

type MarkdownBlock =
  | Readonly<{ kind: 'heading'; depth: number; text: string }>
  | Readonly<{ kind: 'paragraph'; text: string }>
  | Readonly<{ kind: 'quote'; text: string }>
  | Readonly<{ kind: 'list'; items: readonly string[] }>
  | Readonly<{ kind: 'table'; rows: readonly (readonly string[])[] }>;

function markdownBlocks(markdown: string): readonly MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', depth: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (line.startsWith('|') && lines[index + 1]?.trim().match(/^\|?\s*:?-{3,}/u)) {
      const rows: string[][] = [];
      const parseRow = (row: string) =>
        row
          .replace(/^\||\|$/gu, '')
          .split('|')
          .map((cell) => cell.trim());
      rows.push(parseRow(line));
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(parseRow(lines[index].trim()));
        index += 1;
      }
      blocks.push({ kind: 'table', rows });
      continue;
    }
    if (/^[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/u.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/u, ''));
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/u, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/u.test(lines[index].trim()) &&
      !/^[-*]\s+/u.test(lines[index].trim()) &&
      !lines[index].trim().startsWith('|') &&
      !lines[index].trim().startsWith('>')
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

function SafeReport({ markdown }: Readonly<{ markdown: string }>) {
  const blocks = useMemo(
    () => withStableKeys(markdownBlocks(markdown), (block) => JSON.stringify(block)),
    [markdown],
  );
  return (
    <article className="pc-local-review__report">
      {blocks.map(({ key, value: block }): ReactNode => {
        if (block.kind === 'heading') {
          if (block.depth === 1) return null;
          return block.depth === 2 ? (
            <h2 key={key}>
              <InlineMarkdown text={block.text} />
            </h2>
          ) : (
            <h3 key={key}>
              <InlineMarkdown text={block.text} />
            </h3>
          );
        }
        if (block.kind === 'paragraph')
          return (
            <p key={key}>
              <InlineMarkdown text={block.text} />
            </p>
          );
        if (block.kind === 'quote')
          return (
            <blockquote key={key}>
              <InlineMarkdown text={block.text} />
            </blockquote>
          );
        if (block.kind === 'list')
          return (
            <ul key={key}>
              {block.items.map((item) => (
                <li key={item}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ul>
          );
        const [head, ...rows] = block.rows;
        return (
          <section
            className="pc-local-review__table-wrap"
            key={key}
            aria-label="Scrollable report table"
          >
            <table>
              <thead>
                <tr>
                  {withStableKeys(head, (cell) => cell).map(({ key: cellKey, value: cell }) => (
                    <th key={cellKey}>
                      <InlineMarkdown text={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {withStableKeys(rows, (row) => row.join('|')).map(({ key: rowKey, value: row }) => (
                  <tr key={rowKey}>
                    {withStableKeys(row, (cell) => cell).map(({ key: cellKey, value: cell }) => (
                      <td key={cellKey}>
                        <InlineMarkdown text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </article>
  );
}

function toneForPriority(priority: string): 'danger' | 'warn' | 'info' | 'neutral' {
  if (priority.toUpperCase() === 'P0') return 'danger';
  if (priority.toUpperCase() === 'P1') return 'warn';
  if (priority.toUpperCase() === 'P2') return 'info';
  return 'neutral';
}

function ReviewCounts({ counts }: Readonly<{ counts: ReviewCounts }>) {
  return (
    <span className="pc-local-review__counts">
      <span>{counts.decisions} decisions</span>
      <span>{counts.actions} actions</span>
      <span>{counts.gaps} gaps</span>
      <span>{counts.issues} issues</span>
    </span>
  );
}

function MetricStrip({ item }: Readonly<{ item: LocalReviewItem }>) {
  const metrics = [
    ['Decision queue', item.counts.decisions, 'inbox'],
    ['Proposed actions', item.counts.actions, 'git-pull-request'],
    ['Evidence gaps', item.counts.gaps, 'circle-alert'],
    ['Lenses reported', item.lenses.filter((lens) => lens.present).length, 'layers'],
  ] as const;
  return (
    <section className="pc-local-review__metrics" aria-label="Cycle summary">
      {metrics.map(([label, value, icon]) => (
        <div className="pc-local-review__metric" key={label}>
          <span>
            <PcIcon name={icon} size={14} />
            {label}
          </span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function SignalPanel({ item }: Readonly<{ item: LocalReviewItem }>) {
  const first = item.decisions[0];
  return (
    <section className="pc-local-review__signal" aria-labelledby="local-signal-title">
      <div className="pc-local-review__signal-copy">
        <span className="pc-local-review__kicker">
          <span className="pc-local-review__signal-dot" />
          Board signal · {item.signal}
        </span>
        <h2 id="local-signal-title">{first?.title ?? 'Review the latest operating cycle'}</h2>
        <p>{first?.whyNow || item.summary}</p>
      </div>
      <div className="pc-local-review__next-step">
        <span>First verified move</span>
        <strong>{first?.firstStep || 'Open the cycle record and assign its next decision.'}</strong>
        <a href="#/operate/inbox">
          Open decision inbox <PcIcon name="arrow-right" size={13} />
        </a>
      </div>
    </section>
  );
}

function DecisionCard({
  decision,
  compact = false,
}: Readonly<{ decision: Decision; compact?: boolean }>) {
  return (
    <article className="pc-local-review__decision" data-priority={decision.priority.toLowerCase()}>
      <div className="pc-local-review__decision-head">
        <span className="pc-local-review__item-id">{decision.id}</span>
        <Badge tone={toneForPriority(decision.priority)} variant="outline" mono>
          {decision.priority}
        </Badge>
        <h3>{decision.title}</h3>
      </div>
      <p>{decision.recommendation || decision.whyNow}</p>
      <div className="pc-local-review__decision-meta">
        <span>
          <b>Owner</b>
          {decision.owner}
        </span>
        <span>
          <b>Depends on</b>
          {decision.dependencies}
        </span>
      </div>
      {!compact ? (
        <details>
          <summary>Rationale and verification</summary>
          <dl>
            <div>
              <dt>Why now</dt>
              <dd>{decision.whyNow || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>First step</dt>
              <dd>{decision.firstStep || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Expected result</dt>
              <dd>{decision.expectedResult || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Check</dt>
              <dd>{decision.check || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{decision.confidence}</dd>
            </div>
            {decision.dissent ? (
              <div>
                <dt>Dissent</dt>
                <dd>{decision.dissent}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </article>
  );
}

function DecisionGrid({
  decisions,
  limit,
}: Readonly<{ decisions: readonly Decision[]; limit?: number }>) {
  const shown = typeof limit === 'number' ? decisions.slice(0, limit) : decisions;
  if (shown.length === 0)
    return (
      <EmptyState
        icon="inbox"
        title="No decisions recorded"
        description="This cycle did not produce a decision queue."
      />
    );
  return (
    <div className="pc-local-review__decision-grid">
      {shown.map((decision) => (
        <DecisionCard decision={decision} compact={typeof limit === 'number'} key={decision.id} />
      ))}
    </div>
  );
}

function ActionRegister({
  actions,
  limit,
}: Readonly<{ actions: readonly Action[]; limit?: number }>) {
  const shown = typeof limit === 'number' ? actions.slice(0, limit) : actions;
  if (shown.length === 0)
    return (
      <EmptyState
        icon="git-pull-request"
        title="No actions recorded"
        description="No action rows were found in this cycle."
      />
    );
  return (
    <div className="pc-local-review__action-list">
      {shown.map((action) => (
        <a
          className="pc-local-review__action"
          href={`#/operate/actions/${encodeURIComponent(action.id)}`}
          key={action.id}
        >
          <span className="pc-local-review__item-id">{action.id}</span>
          <span className="pc-local-review__action-copy">
            <strong>{action.action}</strong>
            <span>{action.firstStep}</span>
            <small>{action.owner}</small>
          </span>
          <span className="pc-local-review__action-status">
            <Badge tone={toneForPriority(action.priority)} variant="outline" mono>
              {action.priority}
            </Badge>
            <Badge tone={action.state === 'needs-owner' ? 'warn' : 'neutral'}>
              {action.state === 'needs-owner' ? 'Needs owner' : 'Proposed'}
            </Badge>
          </span>
          <PcIcon name="chevron-right" size={14} />
        </a>
      ))}
    </div>
  );
}

function LensBoard({ lenses }: Readonly<{ lenses: readonly Lens[] }>) {
  return (
    <div className="pc-local-review__lenses">
      {lenses.map((lens) => (
        <article
          className="pc-local-review__lens"
          data-present={lens.present || undefined}
          key={lens.name}
        >
          <div>
            <span className="pc-local-review__lens-mark">{lens.name.slice(0, 2)}</span>
            <span>
              <strong>{lens.name}</strong>
              <small>
                {lens.findings}{' '}
                {lens.name === 'Challenger'
                  ? 'exceptions'
                  : lens.name === 'Chair'
                    ? 'decisions'
                    : 'findings'}
              </small>
            </span>
          </div>
          <Badge
            tone={
              lens.signal.includes('insufficient') || !lens.present
                ? 'warn'
                : lens.name === 'Challenger'
                  ? 'info'
                  : 'success'
            }
          >
            {lens.signal}
          </Badge>
          {lens.informed ? <p>{lens.informed}</p> : null}
        </article>
      ))}
    </div>
  );
}

function NamedItems({
  items,
  icon = 'circle-alert',
}: Readonly<{ items: readonly NamedItem[]; icon?: PcIconName }>) {
  if (items.length === 0)
    return (
      <EmptyState
        icon={icon}
        title="Nothing recorded"
        description="No items were found in this section."
      />
    );
  return (
    <div className="pc-local-review__named-list">
      {items.map((item) => (
        <article key={item.id}>
          <span>
            <PcIcon name={icon} size={14} />
            {item.id}
          </span>
          <div>
            <h3>{item.title}</h3>
            {item.detail ? <p>{item.detail}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function EvidenceRegister({ evidence }: Readonly<{ evidence: readonly Evidence[] }>) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(evidence.length / pageSize));
  const boundedPage = Math.min(page, pageCount);
  const visible = evidence.slice((boundedPage - 1) * pageSize, boundedPage * pageSize);
  if (evidence.length === 0)
    return (
      <EmptyState
        icon="file-check"
        title="No source references extracted"
        description="The board report did not include path-addressable evidence."
      />
    );
  return (
    <>
      <div className="pc-local-review__evidence-list">
        {visible.map((entry) => (
          <article key={entry.id}>
            <span className="pc-local-review__item-id">{entry.id}</span>
            <code>{entry.reference}</code>
            <span>{entry.kind}</span>
            <Badge tone="success" icon="check">
              {entry.freshness}
            </Badge>
          </article>
        ))}
      </div>
      {pageCount > 1 ? (
        <nav className="pc-local-review__pagination" aria-label="Evidence pages">
          <Button
            size="sm"
            icon="chevron-left"
            disabled={boundedPage === 1}
            onClick={() => setPage(boundedPage - 1)}
          >
            Previous
          </Button>
          <span>
            {evidence.length} references · page {boundedPage} of {pageCount}
          </span>
          <Button
            size="sm"
            iconAfter="chevron-right"
            disabled={boundedPage === pageCount}
            onClick={() => setPage(boundedPage + 1)}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </>
  );
}

function ReviewList({
  items,
  history = false,
}: Readonly<{ items: readonly LocalReviewSummary[]; history?: boolean }>) {
  return (
    <div className="pc-local-review__list" data-history={history || undefined}>
      {items.map((item, index) => {
        const prior = items[index + 1];
        return (
          <a className="pc-local-review__item" href={item.href} key={item.cycleId}>
            <span className="pc-local-review__item-glyph">
              <PcIcon name={history ? 'history' : 'calendar-days'} size={15} />
            </span>
            <span className="pc-local-review__item-copy">
              <span className="pc-local-review__item-title">
                <strong>{item.title}</strong>
                <Badge tone={item.signal.includes('act') ? 'warn' : 'info'}>{item.signal}</Badge>
              </span>
              <span>{item.summary}</span>
              <ReviewCounts counts={item.counts} />
              {history && prior ? (
                <small>
                  {item.counts.actions - prior.counts.actions >= 0 ? '+' : ''}
                  {item.counts.actions - prior.counts.actions} actions ·{' '}
                  {item.counts.gaps - prior.counts.gaps >= 0 ? '+' : ''}
                  {item.counts.gaps - prior.counts.gaps} gaps from prior cycle
                </small>
              ) : null}
            </span>
            <span className="pc-local-review__item-time">{readableDate(item.updatedAt)}</span>
            <PcIcon name="chevron-right" size={14} />
          </a>
        );
      })}
    </div>
  );
}

function Pagination({
  index,
  onPage,
}: Readonly<{ index: LocalReviewIndex; onPage: (page: number) => void }>) {
  if (index.pagination.pageCount <= 1) return null;
  return (
    <nav className="pc-local-review__pagination" aria-label="Operating review pages">
      <Button
        size="sm"
        icon="chevron-left"
        disabled={index.pagination.page === 1}
        onClick={() => onPage(index.pagination.page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {index.pagination.page} of {index.pagination.pageCount}
      </span>
      <Button
        size="sm"
        iconAfter="chevron-right"
        disabled={index.pagination.page === index.pagination.pageCount}
        onClick={() => onPage(index.pagination.page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

function SectionBlock({
  title,
  description,
  action,
  children,
}: Readonly<{ title: string; description?: string; action?: ReactNode; children: ReactNode }>) {
  return (
    <section className="pc-local-review__section">
      <header>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function TodayView({ item }: Readonly<{ item: LocalReviewItem }>) {
  return (
    <>
      <SignalPanel item={item} />
      <MetricStrip item={item} />
      <div className="pc-local-review__split">
        <SectionBlock
          title="Priority decisions"
          description="Recommendations waiting for owner disposition."
          action={<a href="#/operate/inbox">View all</a>}
        >
          <DecisionGrid decisions={item.decisions} limit={2} />
        </SectionBlock>
        <SectionBlock
          title="Lens coverage"
          description="Independent perspectives and where they converged."
        >
          <LensBoard lenses={item.lenses} />
        </SectionBlock>
      </div>
      <SectionBlock
        title="Next actions"
        description="Concrete first steps extracted from the Chair action plan."
        action={<a href="#/operate/actions">Open register</a>}
      >
        <ActionRegister actions={item.actions} limit={4} />
      </SectionBlock>
      <SectionBlock
        title="Uncertainty to resolve"
        description="Evidence gaps that can change the decision order."
        action={<a href="#/operate/evidence">Inspect evidence</a>}
      >
        <NamedItems items={item.gaps.slice(0, 3)} />
      </SectionBlock>
    </>
  );
}

function InboxView({ item }: Readonly<{ item: LocalReviewItem }>) {
  return (
    <>
      <InlineAlert tone="info" title="Recommendations require human disposition">
        This local cycle can inform a choice, but it cannot approve work or run commands. Assign and
        decide through the governed Operate gateway when available.
      </InlineAlert>
      <div className="pc-local-review__inbox-summary">
        <span>
          <b>{item.decisions.length}</b> decisions waiting
        </span>
        <span>
          <b>{item.actions.filter((action) => action.state === 'needs-owner').length}</b> ownership
          gaps
        </span>
        <span>
          <b>{item.gaps.length}</b> evidence gaps
        </span>
      </div>
      <DecisionGrid decisions={item.decisions} />
      <SectionBlock
        title="Decision-changing gaps"
        description="Resolve these before confidence is treated as durable."
      >
        <NamedItems items={item.gaps} />
      </SectionBlock>
    </>
  );
}

function ActionDetail({ item, actionId }: Readonly<{ item: LocalReviewItem; actionId: string }>) {
  const action = item.actions.find((candidate) => candidate.id === actionId);
  if (!action)
    return (
      <InlineAlert tone="warn" title="Action not found">
        This cycle does not contain {actionId}.
      </InlineAlert>
    );
  return (
    <Card padding={0}>
      <article className="pc-local-review__action-detail">
        <header>
          <span className="pc-local-review__item-id">{action.id}</span>
          <Badge tone={toneForPriority(action.priority)} variant="outline">
            {action.priority}
          </Badge>
          <Badge tone={action.state === 'needs-owner' ? 'warn' : 'neutral'}>
            {action.state === 'needs-owner' ? 'Needs owner' : 'Proposed'}
          </Badge>
        </header>
        <h2>{action.action}</h2>
        <dl>
          <div>
            <dt>Suggested owner</dt>
            <dd>{action.owner}</dd>
          </div>
          <div>
            <dt>First step</dt>
            <dd>{action.firstStep}</dd>
          </div>
          <div>
            <dt>Success measure</dt>
            <dd>{action.successMeasure}</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>{action.check}</dd>
          </div>
          <div>
            <dt>Dependencies</dt>
            <dd>{action.dependencies}</dd>
          </div>
        </dl>
        <InlineAlert tone="info" title="Read-only proposal">
          Execution state begins only after this proposal is accepted through an actor-bound Operate
          session.
        </InlineAlert>
      </article>
    </Card>
  );
}

function OutcomesView({ item }: Readonly<{ item: LocalReviewItem }>) {
  return (
    <>
      <InlineAlert tone="info" title="Expected outcomes, awaiting observed evidence">
        The local review defines success and checks. It does not claim these outcomes occurred.
      </InlineAlert>
      <div className="pc-local-review__outcomes">
        {item.decisions.map((decision) => (
          <article key={decision.id}>
            <header>
              <span className="pc-local-review__item-id">{decision.id}</span>
              <Badge tone="neutral">Awaiting evidence</Badge>
            </header>
            <h3>{decision.expectedResult || decision.title}</h3>
            <div>
              <span>Verification</span>
              <p>{decision.check || 'No check recorded.'}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function RecoveryView({ item }: Readonly<{ item: LocalReviewItem }>) {
  const { recovery } = item;
  return (
    <>
      <section
        className="pc-local-review__integrity"
        data-complete={recovery.complete || undefined}
      >
        <span>
          <PcIcon name={recovery.complete ? 'shield' : 'triangle-alert'} size={20} />
        </span>
        <div>
          <small>Local cycle integrity</small>
          <h2>
            {recovery.complete ? 'Complete review bundle detected' : 'Review bundle is incomplete'}
          </h2>
          <p>
            {recovery.presentFiles.length} readable files · {Math.ceil(recovery.totalBytes / 1024)}{' '}
            KB · {recovery.custody}
          </p>
        </div>
        <Badge tone={recovery.complete ? 'success' : 'warn'}>
          {recovery.complete ? 'Complete' : 'Attention'}
        </Badge>
      </section>
      <div className="pc-local-review__recovery-grid">
        <SectionBlock title="Present records">
          <div className="pc-local-review__file-grid">
            {recovery.presentFiles.map((file) => (
              <span key={file}>
                <PcIcon name="file-check" size={13} />
                {file}
              </span>
            ))}
          </div>
        </SectionBlock>
        <SectionBlock title="Missing records">
          <div className="pc-local-review__file-grid">
            {recovery.missingFiles.length ? (
              recovery.missingFiles.map((file) => (
                <span key={file}>
                  <PcIcon name="circle-alert" size={13} />
                  {file}
                </span>
              ))
            ) : (
              <p className="pc-local-review__muted">No required review records are missing.</p>
            )}
          </div>
        </SectionBlock>
      </div>
      <SectionBlock
        title="Recorded issues"
        description="Cycle limitations and tooling defects preserved with the report."
      >
        <NamedItems items={item.issues} icon="triangle-alert" />
      </SectionBlock>
    </>
  );
}

function CycleDetailView({ item }: Readonly<{ item: LocalReviewItem }>) {
  return (
    <>
      <nav className="pc-local-review__cycle-nav" aria-label="Cycle sections">
        <a href="#/operate/inbox">
          <PcIcon name="inbox" size={13} />
          Decisions
        </a>
        <a href="#/operate/actions">
          <PcIcon name="git-pull-request" size={13} />
          Actions
        </a>
        <a href="#/operate/evidence">
          <PcIcon name="file-check" size={13} />
          Evidence
        </a>
        <a href="#/operate/outcomes">
          <PcIcon name="flag" size={13} />
          Outcomes
        </a>
      </nav>
      <SignalPanel item={item} />
      <MetricStrip item={item} />
      <SectionBlock
        title="Review coverage"
        description="What each lens contributed to the Chair synthesis."
      >
        <LensBoard lenses={item.lenses} />
      </SectionBlock>
      <SectionBlock title="Decision record">
        <DecisionGrid decisions={item.decisions} />
      </SectionBlock>
      <SectionBlock title="Action plan">
        <ActionRegister actions={item.actions} />
      </SectionBlock>
      <SectionBlock
        title="Risks and dissent"
        description="Challenges retained rather than flattened into consensus."
      >
        <NamedItems items={item.risks} icon="circle-alert" />
      </SectionBlock>
      <details className="pc-local-review__full-report">
        <summary>
          <span>
            <PcIcon name="scroll-text" size={15} />
            Full board report
          </span>
          <span>Audit record</span>
        </summary>
        <SafeReport markdown={item.markdown} />
      </details>
    </>
  );
}

function EvidenceDetail({
  item,
  evidenceId,
}: Readonly<{ item: LocalReviewItem; evidenceId: string }>) {
  const entry = item.evidence.find((candidate) => candidate.id === evidenceId);
  if (!entry)
    return (
      <InlineAlert tone="warn" title="Evidence not found">
        This cycle does not contain {evidenceId}.
      </InlineAlert>
    );
  return (
    <Card>
      <article className="pc-local-review__evidence-detail">
        <Badge tone="success" icon="check">
          {entry.freshness}
        </Badge>
        <h2>
          {entry.id} · {entry.kind}
        </h2>
        <code>{entry.reference}</code>
        <p>
          This source reference was captured by the completed local cycle. OpenPlanr has not re-read
          the target to claim current freshness.
        </p>
      </article>
    </Card>
  );
}

function LocalRouteView({
  route,
  item,
}: Readonly<{ route: ParsedDashboardRoute; item: LocalReviewItem }>) {
  switch (route.kind) {
    case 'operate.today':
      return <TodayView item={item} />;
    case 'operate.inbox':
      return <InboxView item={item} />;
    case 'operate.actions':
      return <ActionRegister actions={item.actions} />;
    case 'operate.action':
      return <ActionDetail item={item} actionId={route.subjectId} />;
    case 'operate.evidence':
      return <EvidenceRegister evidence={item.evidence} />;
    case 'operate.evidence-item':
      return <EvidenceDetail item={item} evidenceId={route.subjectId} />;
    case 'operate.outcomes':
      return <OutcomesView item={item} />;
    case 'operate.recovery':
      return <RecoveryView item={item} />;
    case 'operate.cycle':
    case 'operate.review':
      return <CycleDetailView item={item} />;
    default:
      return <TodayView item={item} />;
  }
}

function EmptyReviews() {
  return (
    <Card>
      <EmptyState
        icon="calendar-days"
        title="No completed local reviews yet"
        description="Complete an Operate review in your agent host. This read-only console refreshes when a board report is completed."
      />
    </Card>
  );
}

const TITLES: Partial<Record<ParsedDashboardRoute['kind'], readonly [string, string]>> = {
  'operate.today': [
    'Operate today',
    'The current signal, priority choices, action load, and independent lens coverage.',
  ],
  'operate.inbox': [
    'Decision inbox',
    'Recommendations, ownership gaps, and evidence questions waiting for attention.',
  ],
  'operate.actions': [
    'Action register',
    'Proposed work with owners, first steps, success measures, and verification.',
  ],
  'operate.cycles': [
    'Operating cycles',
    'Completed local reviews, grouped as durable read-only records.',
  ],
  'operate.evidence': [
    'Evidence register',
    'Source locations captured by the current cycle, with explicit freshness.',
  ],
  'operate.outcomes': [
    'Outcome tracking',
    'Expected effects and verification checks, separated from observed results.',
  ],
  'operate.history': ['Operating history', 'Cycle chronology and change from the prior review.'],
  'operate.recovery': [
    'Cycle integrity',
    'Readable records, missing inputs, custody, and known review issues.',
  ],
  'operate.action': [
    'Action detail',
    'The exact local proposal, owner, first step, measure, and check.',
  ],
  'operate.evidence-item': [
    'Evidence detail',
    'The exact source reference and its freshness boundary.',
  ],
};

export function LocalOperateReviews({
  route,
  origin,
}: Readonly<{ route: ParsedDashboardRoute; origin: string }>) {
  const [page, setPage] = useState(1);
  const indexState = useLocalReviewIndex(origin, page);
  const index = indexState.data ?? EMPTY_INDEX;
  const listRoute = route.kind === 'operate.cycles' || route.kind === 'operate.history';
  const selectedCycleId =
    route.kind === 'operate.cycle' || route.kind === 'operate.review'
      ? route.kind === 'operate.review'
        ? route.cycleId
        : route.subjectId
      : listRoute
        ? null
        : (index.items[0]?.cycleId ?? null);
  const detailState = useLocalReviewDetail(origin, selectedCycleId);
  const detail = detailState.data?.item ?? null;
  const routeCopy = TITLES[route.kind];
  const title =
    route.kind === 'operate.cycle' || route.kind === 'operate.review'
      ? (detail?.title ?? (route.kind === 'operate.review' ? route.cycleId : route.subjectId))
      : (routeCopy?.[0] ?? 'Operate');
  const description =
    route.kind === 'operate.cycle' || route.kind === 'operate.review'
      ? 'Structured decisions, action plan, lens coverage, dissent, and the full audit record.'
      : (routeCopy?.[1] ?? 'Completed local operating review.');

  return (
    <div className="pc-shell__scroll pc-local-review" data-route-kind={route.kind}>
      <SectionHeader
        eyebrow="planr-operate · local"
        title={title}
        count={listRoute ? index.pagination.total : undefined}
        description={description}
        actions={
          <Badge tone="info" variant="outline" icon="lock">
            Read-only
          </Badge>
        }
      />
      {indexState.status === 'failed' ? (
        <InlineAlert tone="warn" title="Local reviews could not refresh">
          {indexState.error}
        </InlineAlert>
      ) : null}
      {listRoute ? (
        indexState.status === 'loading' && !indexState.data ? (
          <SkeletonCards count={3} />
        ) : index.items.length ? (
          <>
            <ReviewList items={index.items} history={route.kind === 'operate.history'} />
            <Pagination index={index} onPage={setPage} />
          </>
        ) : (
          <EmptyReviews />
        )
      ) : !selectedCycleId && indexState.status === 'loading' ? (
        <SkeletonCards count={2} />
      ) : !selectedCycleId ? (
        <EmptyReviews />
      ) : detailState.status === 'loading' && !detail ? (
        <SkeletonCards count={3} />
      ) : !detail ? (
        <InlineAlert tone="warn" title="This local review is unavailable">
          {detailState.error ?? 'The report was not found.'}
        </InlineAlert>
      ) : (
        <>
          {detailState.status === 'failed' ? (
            <InlineAlert tone="warn" title="Showing the last readable review">
              {detailState.error}
            </InlineAlert>
          ) : null}
          <LocalRouteView route={route} item={detail} />
        </>
      )}
      <div className="pc-local-review__footnote">
        <PcIcon name="lock" size={12} /> Local projections are review records. Approval and
        execution require an actor-bound Operate session.
      </div>
    </div>
  );
}
