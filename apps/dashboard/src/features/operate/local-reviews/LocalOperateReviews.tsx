import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { ParsedDashboardRoute } from '../../../app/router.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineAlert,
  PcIcon,
  SectionHeader,
  SkeletonCards,
} from '../../../design-system/components/index.js';
import './local-operate-reviews.css';

type ReviewCounts = Readonly<{ decisions: number; actions: number; issues: number }>;
type LocalReviewSummary = Readonly<{
  cycleId: string;
  title: string;
  summary: string;
  updatedAt: string;
  counts: ReviewCounts;
  href: string;
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
  item: LocalReviewSummary & Readonly<{ markdown: string }>;
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

function localReviewSummary(value: unknown): value is LocalReviewSummary {
  if (!isRecord(value) || !isRecord(value.counts)) return false;
  const counts = value.counts;
  return (
    typeof value.cycleId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.href === 'string' &&
    ['decisions', 'actions', 'issues'].every((key) => Number.isSafeInteger(counts[key]))
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
  const { pagination } = value;
  if (
    !['page', 'pageSize', 'pageCount', 'total'].every((key) =>
      Number.isSafeInteger(pagination[key]),
    )
  ) {
    throw new Error('OpenPlanr returned invalid local review pagination.');
  }
  return value as unknown as LocalReviewIndex;
}

function parseDetail(value: unknown): LocalReviewDetail {
  const item = isRecord(value) ? value.item : null;
  const markdown = isRecord(item) ? item.markdown : null;
  if (
    !isRecord(value) ||
    value.kind !== 'local-operate-review' ||
    value.schemaVersion !== '1.0.0' ||
    value.readOnly !== true ||
    !isRecord(item) ||
    !localReviewSummary(item) ||
    typeof markdown !== 'string'
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
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={key}>{part.slice(1, -1)}</code>;
        }
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
        if (block.kind === 'list') {
          return (
            <ul key={key}>
              {block.items.map((item) => (
                <li key={item}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ul>
          );
        }
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

function ReviewCounts({ counts }: Readonly<{ counts: ReviewCounts }>) {
  return (
    <span className="pc-local-review__counts">
      <span>{counts.decisions} decisions</span>
      <span>{counts.actions} actions</span>
      <span>{counts.issues} issues</span>
    </span>
  );
}

function ReviewList({
  items,
  history = false,
}: Readonly<{ items: readonly LocalReviewSummary[]; history?: boolean }>) {
  return (
    <div className="pc-local-review__list" data-history={history || undefined}>
      {items.map((item) => (
        <a className="pc-local-review__item" href={item.href} key={item.cycleId}>
          <span className="pc-local-review__item-glyph" aria-hidden="true">
            <PcIcon name={history ? 'history' : 'calendar-days'} size={15} />
          </span>
          <span className="pc-local-review__item-copy">
            <strong>{item.title}</strong>
            <span>{item.summary}</span>
            <ReviewCounts counts={item.counts} />
          </span>
          <span className="pc-local-review__item-time">{readableDate(item.updatedAt)}</span>
          <PcIcon name="chevron-right" size={14} color="var(--pc-text-tertiary)" />
        </a>
      ))}
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

function DetailView({ state }: Readonly<{ state: LoadState<LocalReviewDetail> }>) {
  if (state.status === 'loading' && !state.data)
    return <SkeletonCards count={1} height={360} label="Loading operating review" />;
  if (!state.data) {
    return (
      <InlineAlert tone="warn" title="This local review is unavailable">
        {state.error ?? 'The report was not found.'}
      </InlineAlert>
    );
  }
  const { item } = state.data;
  return (
    <>
      {state.status === 'failed' ? (
        <InlineAlert tone="warn" title="Showing the last readable report">
          {state.error}
        </InlineAlert>
      ) : null}
      <Card padding={0}>
        <div className="pc-local-review__meta">
          <ReviewCounts counts={item.counts} />
          <span>Updated {readableDate(item.updatedAt)}</span>
        </div>
        <SafeReport markdown={item.markdown} />
      </Card>
    </>
  );
}

function EmptyReviews() {
  return (
    <Card>
      <EmptyState
        icon="calendar-days"
        title="No completed local reviews yet"
        description="Complete an Operate review in your agent host. This read-only view refreshes when a board report is completed."
      />
    </Card>
  );
}

export function LocalOperateReviews({
  route,
  origin,
}: Readonly<{ route: ParsedDashboardRoute; origin: string }>) {
  const [page, setPage] = useState(1);
  const indexState = useLocalReviewIndex(origin, page);
  const index = indexState.data ?? EMPTY_INDEX;
  const selectedCycleId =
    route.kind === 'operate.cycle'
      ? route.subjectId
      : route.kind === 'operate.today'
        ? (index.items[0]?.cycleId ?? null)
        : null;
  const detailState = useLocalReviewDetail(origin, selectedCycleId);
  const listRoute = route.kind === 'operate.cycles' || route.kind === 'operate.history';
  const title =
    route.kind === 'operate.history'
      ? 'Review history'
      : route.kind === 'operate.cycles'
        ? 'Operating cycles'
        : route.kind === 'operate.today'
          ? 'Latest operating review'
          : route.kind === 'operate.cycle'
            ? (detailState.data?.item.title ?? route.subjectId)
            : 'Operate';
  const description =
    route.kind === 'operate.history'
      ? 'Completed local board reports, newest first.'
      : route.kind === 'operate.cycles'
        ? 'Read-only operating reviews produced in this project.'
        : route.kind === 'operate.today'
          ? 'The newest completed local board report. This view refreshes automatically.'
          : route.kind === 'operate.cycle'
            ? 'Decision record, actions, dissent and review coverage.'
            : 'This surface requires a governed Operate session.';

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
      {route.kind === 'operate.cycle' || route.kind === 'operate.today' ? (
        selectedCycleId ? (
          <DetailView state={detailState} />
        ) : indexState.status === 'loading' ? (
          <SkeletonCards count={1} />
        ) : (
          <EmptyReviews />
        )
      ) : listRoute ? (
        indexState.status === 'loading' && !indexState.data ? (
          <SkeletonCards count={3} />
        ) : index.items.length > 0 ? (
          <>
            <ReviewList items={index.items} history={route.kind === 'operate.history'} />
            <Pagination index={index} onPage={setPage} />
          </>
        ) : (
          <EmptyReviews />
        )
      ) : (
        <Card padding={0}>
          <div className="pc-local-review__gateway">
            <span className="pc-local-review__gateway-glyph" aria-hidden="true">
              <PcIcon name="lock" size={19} />
            </span>
            <div>
              <h2>Governed session required</h2>
              <p>
                Inbox, actions, evidence, outcomes and recovery need an actor-bound Operate gateway.
                Completed local reports remain available in Cycles and History.
              </p>
            </div>
            <div className="pc-local-review__gateway-actions">
              <a href="#/operate/cycles">View cycles</a>
              <a href="#/operate/history">View history</a>
            </div>
          </div>
        </Card>
      )}
      <div className="pc-local-review__footnote">
        Local review reports are presentation records. They do not grant command authority or
        represent governed Operate state.
      </div>
    </div>
  );
}
