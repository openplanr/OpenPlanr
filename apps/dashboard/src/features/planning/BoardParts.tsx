import {
  Button,
  Checkbox,
  CommandHint,
  EmptyState,
  PcIcon,
  SegmentedControl,
  Tabs,
} from '../../design-system/components/index.js';
import type { BoardLane } from './planning-board-projection.js';
import { BOARD_LANE_PAGE_SIZE } from './planning-board-window.js';
import { type PlanningGroup, planningArtifactStatusLabel } from './planning-model.js';

export function BoardHeader({
  count,
  lanes,
  phone,
  hideDone,
  onView,
  onHideDone,
}: {
  count: number;
  lanes: boolean;
  phone: boolean;
  hideDone: boolean;
  onView: (value: string) => void;
  onHideDone: (hidden: boolean) => void;
}) {
  return (
    <header className="pc-status-board__header">
      <h1>Board</h1>
      <span className="pc-status-board__total">{count} items</span>
      <span className="pc-status-board__divider" aria-hidden="true" />
      <div className="pc-status-board__toggle">
        <SegmentedControl
          label="View"
          options={[
            phone
              ? { key: 'columns', label: 'Columns' }
              : { key: 'columns', label: 'Columns', icon: 'columns-3' },
            phone
              ? { key: 'lanes', label: 'Lanes' }
              : { key: 'lanes', label: 'Lanes by spec', icon: 'rows-3' },
          ]}
          value={lanes ? 'lanes' : 'columns'}
          onChange={onView}
        />
      </div>
      <Checkbox label="Hide done" checked={hideDone} onChange={onHideDone} />
      <p className="pc-status-board__note">
        <PcIcon name="lock" size={13} />
        Read-only. Status changes come from the CLI.
      </p>
    </header>
  );
}

export function BoardBlank({ filtered }: { filtered: boolean }) {
  return (
    <div className="pc-status-board__blank">
      <EmptyState
        icon="columns-3"
        title={filtered ? 'No matching artifacts' : 'No artifacts yet'}
        description={
          filtered
            ? 'The shared presentation filters exclude all Board cards. Open Board without filters to see the full plan.'
            : 'The board fills in as the plan gains artifacts.'
        }
        action={
          filtered ? (
            <a href="#/board" className="op-inline-action">
              Clear filters
            </a>
          ) : (
            <CommandHint command="/planr:spec" label="Shape the next spec" size="sm" />
          )
        }
      />
    </div>
  );
}

export function BoardLaneHead({ lane }: { lane: BoardLane }) {
  const progress = lane.progress;
  return (
    <header className="pc-status-board__lane-head">
      {lane.spec ? <span className="pc-status-board__lane-id">{lane.key}</span> : null}
      <h2>{lane.spec?.title ?? lane.label}</h2>
      {progress?.total ? (
        <span className="pc-status-board__progress">
          <span aria-hidden="true">
            <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </span>
          {progress.done} of {progress.total} done
        </span>
      ) : null}
    </header>
  );
}

export function BoardPager({
  page,
  pages,
  lanes,
  setPage,
}: {
  page: number;
  pages: number;
  lanes: number;
  setPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="pc-status-board__pager">
      <Button
        size="sm"
        disabled={page === 0}
        disabledReason={page === 0 ? 'First page of spec lanes' : undefined}
        onClick={() => setPage(page - 1)}
      >
        Previous lanes
      </Button>
      <span>
        Lanes {page * BOARD_LANE_PAGE_SIZE + 1}-{Math.min(lanes, (page + 1) * BOARD_LANE_PAGE_SIZE)}{' '}
        of {lanes}
      </span>
      <Button
        size="sm"
        disabled={page + 1 === pages}
        disabledReason={page + 1 === pages ? 'Last page of spec lanes' : undefined}
        onClick={() => setPage(page + 1)}
      >
        Next lanes
      </Button>
    </div>
  );
}

export function BoardStatusTabs({
  columns,
  value,
  onChange,
}: {
  columns: readonly PlanningGroup[];
  value: string;
  onChange: (status: string) => void;
}) {
  return (
    <div className="pc-status-board__tabs">
      <Tabs
        label="Status"
        variant="pill"
        value={value}
        onChange={onChange}
        tabs={columns.map((column) => ({
          id: column.key,
          label: planningArtifactStatusLabel(column.key),
          count: column.nodes.length,
        }))}
      />
    </div>
  );
}
