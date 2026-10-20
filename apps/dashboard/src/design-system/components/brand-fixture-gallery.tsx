import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import type { PlanningModelGraph } from '../../features/planning/planning-model.js';
import { installKeyboardCoordinator } from '../../features/shell/keyboard-coordinator.js';
import {
  ArtifactRowCopy,
  ArtifactRowMeta,
  ArtifactRowTitle,
  ArtifactStatus,
  ArtifactTag,
  type ArtifactType,
  artifactRowStyle,
  Button,
  Card,
  type ChipSurface,
  CommandHint,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Inspector,
  Kbd,
  PriorityChip,
  SegmentedControl,
  Select,
  SkeletonTable,
  StatePanel,
  type StatePanelState,
  Switch,
  Tabs,
  Toast,
  Tooltip,
  WorkItemChip,
} from './index.js';

export type GalleryState =
  | 'normal'
  | 'hover'
  | 'focus-visible'
  | 'active'
  | 'disabled'
  | 'loading'
  | 'empty'
  | 'error'
  | 'reduced-motion';
type SourceRecord = Readonly<{
  id: string;
  tag: string;
  attributes: Readonly<Record<string, string | null>>;
  content: readonly (string | { recordId: string })[];
}>;
type GallerySource = Readonly<{ records: readonly SourceRecord[] }>;
export type BrandFixtureGalleryProps = Readonly<{
  state: GalleryState;
  clock: string;
  graph: PlanningModelGraph;
  sources: Readonly<Record<string, GallerySource>>;
}>;

const TYPES: readonly ArtifactType[] = ['spec', 'us', 't', 'bl', 'adr', 'epic', 'sprint', 'qt'];
const STATUSES = ['outstanding', 'in-progress', 'blocked', 'addressed', 'done', 'quiet'];
const SURFACES: readonly ChipSurface[] = ['bg', 'panel', 'card', 'raised'];
const COLORS = [
  'bg',
  'panel',
  'card',
  'raised',
  'line',
  'line-strong',
  'text',
  'heading',
  'body',
  'muted',
  'dim',
  'accent',
  'accent-soft',
  'on-accent',
  'info',
  'danger',
  'warning',
  'addressed',
  ...TYPES.map((type) => `type-${type}`),
];
const TEXT_STYLES = [
  'display',
  'page',
  'heading',
  'section',
  'body',
  'control',
  'label',
  'eyebrow',
  'technical',
] as const;
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
  gap: 24,
};
const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const row: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 };

function sourceText(source: GallerySource, record: SourceRecord): string {
  return record.content
    .map((part) => {
      if (typeof part === 'string') return part;
      const child = source.records.find((entry) => entry.id === part.recordId);
      if (!child) throw new Error(`Gallery source record ${part.recordId} is missing.`);
      return sourceText(source, child);
    })
    .join(' ');
}

function sourceChildren(source: GallerySource, record: SourceRecord): SourceRecord[] {
  return record.content.flatMap((part) => {
    if (typeof part === 'string') return [];
    const child = source.records.find((entry) => entry.id === part.recordId);
    if (!child) throw new Error(`Gallery source record ${part.recordId} is missing.`);
    return [child];
  });
}

function traceNodes(source: GallerySource, graph: PlanningModelGraph) {
  const panel = source.records.find(
    (record) =>
      record.attributes.class?.split(' ').includes('panel') &&
      sourceChildren(source, record).some(
        (child) => child.tag === 'h2' && sourceText(source, child) === 'Trace rail',
      ),
  );
  if (!panel) throw new Error('Gallery Components artboard has no trace rail.');
  const tags = sourceChildren(source, panel)
    .flatMap((record) => sourceChildren(source, record))
    .filter((record) => record.attributes.class?.split(' ').includes('tag'));
  return tags.map((tag) => {
    const id = sourceText(source, tag);
    const node = graph.nodes.find((entry) => entry.frontmatter.id === id);
    if (!node) throw new Error(`Gallery trace artifact ${id} is missing.`);
    return node;
  });
}

function sourceHeading(source: GallerySource): string {
  const heading = source.records.find((record) => record.tag === 'h1');
  if (!heading) throw new Error('Gallery artboard has no heading.');
  return sourceText(source, heading);
}

function Recipe({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-gallery-recipe={name} style={stack}>
      {children}
    </div>
  );
}

function StateTile({
  source,
  tile,
  state,
  disabled,
  onClear,
  onCopy,
}: {
  source: GallerySource;
  tile: SourceRecord;
  state: StatePanelState | undefined;
  disabled: boolean;
  onClear: () => void;
  onCopy: () => Promise<void>;
}) {
  const children = sourceChildren(source, tile);
  const heading = children.find((entry) => entry.tag === 'strong');
  const description =
    children.find((entry) => entry.tag === 'p') ?? children.find((entry) => entry.tag === 'div');
  const kind = children.find((entry) => entry.attributes.class?.split(' ').includes('k'));
  const commands = children.filter((entry) => entry.attributes.class?.split(' ').includes('cmd'));
  const details = children
    .filter((entry) => entry.tag === 'p' && entry !== description)
    .map((entry) => sourceText(source, entry));
  if (state === 'offline')
    details.push(
      ...children.filter((entry) => entry.tag === 'div').map((entry) => sourceText(source, entry)),
    );
  if (!heading || !description || !kind || !state)
    throw new Error(`Incomplete gallery state tile ${tile.id}.`);
  return (
    <Recipe name={`state-${state}`}>
      <StatePanel
        state={state}
        eyebrow={sourceText(source, kind)}
        title={sourceText(source, heading)}
        description={sourceText(source, description)}
        detail={details.join(' ') || undefined}
        actions={
          commands.length > 0 || state === 'empty' ? (
            <div style={stack}>
              {commands.map((command) => (
                <CommandHint
                  key={command.id}
                  command={sourceText(source, command).replace(/^(?:\$|›)\s*/u, '')}
                  disabled={disabled}
                  onCopy={onCopy}
                />
              ))}
              {state === 'empty' ? (
                <Button disabled={disabled} onClick={onClear}>
                  Clear 3 filters
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </Recipe>
  );
}

function inspectorState(state: GalleryState) {
  switch (state) {
    case 'loading':
    case 'empty':
    case 'error':
      return state;
    default:
      return 'ready';
  }
}

/** Test-harness presentation of the shared recipes with caller-owned artboard data. */
export function BrandFixtureGallery({ state, clock, graph, sources }: BrandFixtureGalleryProps) {
  const root = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState('findings');
  const [segment, setSegment] = useState('list');
  const [checked, setChecked] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const disabled = state === 'disabled';
  const reason = disabled ? 'Unavailable in this fixture state.' : undefined;
  const copy = async () => {
    if (state === 'error') throw new Error('Fixture clipboard access was denied.');
    if (state === 'loading') await new Promise<void>(() => undefined);
  };
  const tokens = sources.Tokens;
  const components = sources.Components;
  const states = sources.States;
  if (!tokens || !components || !states)
    throw new Error('Gallery requires Tokens, Components and States artboards.');
  const rowIds = components.records
    .filter((record) => record.attributes.class?.split(' ').includes('trow'))
    .flatMap((record) =>
      record.content.flatMap((part) => {
        if (typeof part === 'string') return [];
        const child = components.records.find((entry) => entry.id === part.recordId);
        return child?.attributes.class?.split(' ').includes('tag')
          ? [sourceText(components, child)]
          : [];
      }),
    );
  const examples = rowIds.flatMap((id) => graph.nodes.filter((node) => node.frontmatter.id === id));
  if (examples.length !== 4)
    throw new Error(`Gallery requires four artboard rows; received ${examples.length}.`);
  const first = examples[0];
  const trace = traceNodes(components, graph);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    return installKeyboardCoordinator(document, () => ({
      root: element,
      selectionScope: 'brand-gallery',
      singleLetters: !disabled,
      paletteOpen: false,
      togglePalette: () => setAnnouncement('Palette is shown in the workspace fixture.'),
      openHelp: () =>
        setAnnouncement('Use J and K to move through rows, Enter to inspect, Escape to close.'),
      navigate: (href) => setAnnouncement(`Fixture navigation: ${href}`),
      closeInspector: () => {
        if (!inspector) return false;
        setInspector(false);
        return true;
      },
      selectedId: () => selected,
      copy: async (text) => setAnnouncement(`Copied ${text}`),
      announce: setAnnouncement,
    }));
  }, [disabled, inspector, selected]);

  const stateTiles = states.records.filter((record) =>
    record.attributes.class?.split(' ').includes('tile'),
  );
  const panelStates: readonly StatePanelState[] = [
    'booting',
    'first-use',
    'empty',
    'offline',
    'error',
    'incompatible',
  ];
  return (
    <main
      ref={root}
      data-brand-gallery
      data-gallery-state={state}
      data-clock={clock}
      style={{
        ...stack,
        width: 1440,
        padding: '64px 80px',
        gap: 44,
        boxSizing: 'border-box',
        color: 'var(--op-text)',
        background: 'var(--op-bg)',
      }}
    >
      <section data-gallery-artboard="Tokens" style={stack}>
        <h1 style={{ font: 'var(--pc-type-display)' }}>{sourceHeading(tokens)}</h1>
        <div style={{ ...grid, gridTemplateColumns: 'repeat(6,minmax(0,1fr))' }}>
          {COLORS.map((name) => (
            <div key={name} data-gallery-token={name} style={stack}>
              <div
                style={{
                  height: 56,
                  borderRadius: 10,
                  background: `var(--op-${name})`,
                  border: '1px solid var(--op-line)',
                }}
              />
              <code>{name}</code>
            </div>
          ))}
        </div>
        {TEXT_STYLES.map((name) => (
          <div
            key={name}
            data-gallery-text-style={name}
            style={{
              fontFamily: `var(--op-font-${['display', 'page', 'heading'].includes(name) ? 'display' : ['technical', 'eyebrow'].includes(name) ? 'technical' : 'ui'})`,
              fontSize: `var(--op-type-${name}-size)`,
              fontWeight: `var(--op-type-${name}-weight)`,
              lineHeight: name === 'label' ? 'normal' : `var(--op-type-${name}-leading)`,
            }}
          >
            {name} · {first.title}
          </div>
        ))}
        <div style={row}>
          {[4, 8, 12, 16, 24, 32, 48, 64].map((size) => (
            <div
              key={size}
              data-gallery-space={size}
              style={{ width: size, height: size, background: 'var(--op-accent)' }}
            />
          ))}
        </div>
        <div style={grid}>
          {['tag', 'control', 'surface', 'sheet'].map((name) => (
            <div
              key={name}
              data-gallery-radius={name}
              style={{
                height: 72,
                borderRadius: `var(--op-radius-${name})`,
                background: 'var(--op-card)',
                border: '1px solid var(--op-line-strong)',
              }}
            >
              {name}
            </div>
          ))}
        </div>
        <div style={grid}>
          {['none', 'menu', 'float'].map((name) => (
            <div
              key={name}
              data-gallery-shadow={name}
              style={{
                height: 64,
                borderRadius: 12,
                background: 'var(--op-card)',
                boxShadow: name === 'none' ? 'none' : `var(--op-shadow-${name})`,
              }}
            >
              {name}
            </div>
          ))}
        </div>
      </section>
      <fieldset
        disabled={disabled}
        aria-label="Component recipes"
        style={{ ...stack, border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <section data-gallery-artboard="Components" style={stack}>
          <h1 style={{ font: 'var(--pc-type-display)' }}>{sourceHeading(components)}</h1>
          <div style={grid}>
            <Card title="Status">
              <Recipe name="status">
                {STATUSES.map((status) => (
                  <ArtifactStatus key={status} status={status} />
                ))}
              </Recipe>
            </Card>
            <Card title="Artifact types">
              <Recipe name="tag">
                {TYPES.map((type) => (
                  <ArtifactTag key={type} type={type}>
                    {type.toUpperCase()}
                  </ArtifactTag>
                ))}
              </Recipe>
            </Card>
            <Card title="Priorities">
              <Recipe name="priority">
                {['P0', 'high', 'medium', 'low', 'none'].map((priority) => (
                  <PriorityChip key={priority} priority={priority} />
                ))}
              </Recipe>
            </Card>
          </div>
          <fieldset
            disabled={disabled}
            style={{ ...grid, border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <Card title="Buttons and keys">
              <div style={stack}>
                {(['primary', 'secondary', 'ghost', 'danger', 'inverse'] as const).map(
                  (variant) => (
                    <Recipe key={variant} name={`button-${variant}`}>
                      <Button
                        variant={variant}
                        disabled={disabled}
                        disabledReason={reason}
                        loading={state === 'loading'}
                        aria-pressed={state === 'active'}
                      >
                        {variant === 'primary' ? 'Open trace' : variant}
                      </Button>
                    </Recipe>
                  ),
                )}
                <Recipe name="icon-button">
                  <IconButton icon="plus" label="Add filter" disabled={disabled} />
                </Recipe>
                <Recipe name="keys">
                  <div style={row}>
                    {['⌘', 'K', 'J', 'G', 'L', 'Esc'].map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </div>
                </Recipe>
              </div>
            </Card>
            <Card title="Inputs and filters">
              <div style={stack}>
                <Recipe name="input">
                  <Input
                    ariaLabel="Filter by ID or title"
                    value={state === 'empty' ? '' : filter}
                    onChange={setFilter}
                    disabled={disabled}
                    disabledReason={reason}
                    error={state === 'error' ? 'The filter could not be read.' : undefined}
                  />
                </Recipe>
                <Recipe name="filter">
                  <Select
                    ariaLabel="Artifact type"
                    value="Backlog"
                    options={['Backlog', 'Task', 'Story']}
                    onChange={setFilter}
                    disabled={disabled}
                    disabledReason={reason}
                    error={state === 'error' ? 'Filter options unavailable.' : undefined}
                  />
                </Recipe>
                <Recipe name="segmented">
                  <SegmentedControl
                    label="Layout"
                    options={[
                      { key: 'list', label: 'List' },
                      { key: 'board', label: 'Board' },
                    ]}
                    value={segment}
                    onChange={setSegment}
                  />
                </Recipe>
                <Recipe name="switch">
                  <Switch
                    label="Keyboard shortcuts"
                    checked={checked}
                    onChange={setChecked}
                    disabled={disabled}
                    disabledReason={reason}
                  />
                </Recipe>
                <Recipe name="tabs">
                  <Tabs
                    label="Artifact details"
                    value={segment}
                    tabs={[
                      { id: 'list', label: 'Properties' },
                      { id: 'board', label: 'History' },
                    ]}
                    onChange={setSegment}
                  />
                </Recipe>
              </div>
            </Card>
            <Card title="Action as a command">
              <Recipe name="command">
                <CommandHint
                  command={`openplanr backlog show ${first.id}`}
                  disabled={disabled}
                  disabledReason={reason}
                  onCopy={copy}
                />
              </Recipe>
              <Recipe name="tooltip">
                <Tooltip content="Copy a verified command">
                  <button
                    type="button"
                    className="pc-button"
                    data-variant="secondary"
                    data-size="md"
                    disabled={disabled}
                  >
                    Command help
                  </button>
                </Tooltip>
              </Recipe>
            </Card>
          </fieldset>
          <Card title="Table rows" padding={0}>
            <Recipe name="row">
              <div
                data-route-kind="planning.list"
                style={artifactRowStyle(examples.map((node) => node.id))}
              >
                {examples.map((node, index) => (
                  <div
                    key={node.id}
                    className="pc-artifact-row"
                    data-selected={
                      selected === node.id || (state === 'active' && index === 0) || undefined
                    }
                    data-live-patch={index === 1 || undefined}
                  >
                    <button
                      type="button"
                      className="pc-artifact-row__link"
                      data-keyboard-item={node.id}
                      data-canonical-id={node.id}
                      disabled={disabled}
                      onFocus={() => setSelected(node.id)}
                      onClick={() => {
                        setSelected(node.id);
                        setInspector(true);
                      }}
                    >
                      <span className="pc-artifact-row__id">
                        <WorkItemChip type={node.type} id={node.id} />
                      </span>
                      <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
                    </button>
                    <span className="pc-artifact-row__meta-group">
                      <ArtifactRowMeta label="Status">
                        <ArtifactStatus status={node.status} variant="glyph" />
                      </ArtifactRowMeta>
                    </span>
                    <ArtifactRowCopy
                      id={node.id}
                      command={disabled ? null : `openplanr status ${node.id} --md`}
                      onCopy={copy}
                    />
                  </div>
                ))}
              </div>
            </Recipe>
          </Card>
          <div className="pc-list" style={{ '--id-col': '160px' } as CSSProperties}>
            <Recipe name="table">
              {state === 'loading' ? (
                <SkeletonTable
                  columns={[{ label: 'ID', width: 160 }, { label: 'Title' }]}
                  rows={4}
                  label="Reading planning files"
                />
              ) : (
                <DataTable
                  caption="Artboard records"
                  columns={[
                    { key: 'id', label: 'ID', width: 160 },
                    { key: 'title', label: 'Title' },
                  ]}
                  rows={state === 'empty' ? [] : examples}
                  selectedId={selected ?? undefined}
                  onRowClick={
                    disabled
                      ? undefined
                      : (node) => {
                          setSelected(node.id);
                          setInspector(true);
                        }
                  }
                  emptyMessage="No matching artboard records."
                />
              )}
            </Recipe>
          </div>
          <div style={grid}>
            <Card title="Trace rail">
              <Recipe name="trace">
                <div style={row}>
                  {trace.map((node) => (
                    <WorkItemChip
                      key={node.id}
                      type={node.type}
                      id={node.id}
                      onClick={() => setSelected(node.id)}
                      disabled={disabled}
                    />
                  ))}
                </div>
              </Recipe>
            </Card>
            <Card title="Toasts">
              <Recipe name="toast">
                <Toast
                  kind={state === 'error' ? 'error' : 'disk-change'}
                  title="3 items changed on disk"
                >
                  {examples
                    .slice(0, 3)
                    .map((node) => node.frontmatter.id)
                    .join(', ')}{' '}
                  · Show
                </Toast>
              </Recipe>
            </Card>
            <Card title="Empty state">
              <Recipe name="empty">
                <EmptyState
                  title="No active sprint"
                  description="Pick the next sprint against capacity and the release cut."
                  action={<CommandHint command="/planr:sprint" disabled={disabled} onCopy={copy} />}
                />
              </Recipe>
            </Card>
          </div>
          <Recipe name="inspector">
            <Button disabled={disabled} onClick={() => setInspector(true)}>
              Open side panel
            </Button>
            <Inspector
              open={inspector}
              onOpenChange={setInspector}
              onRestoreFocus={() =>
                root.current
                  ?.querySelector<HTMLElement>(
                    `[data-canonical-id="${CSS.escape(selected ?? first.id)}"]`,
                  )
                  ?.focus({ preventScroll: true })
              }
              title={examples.find((node) => node.id === selected)?.title ?? first.title}
              description="Artboard side panel"
              state={inspectorState(state)}
              reason={
                state === 'error' ? 'The selected fixture record could not be read.' : undefined
              }
            >
              <CommandHint
                command={`openplanr status ${selected ?? first.id} --md`}
                onCopy={copy}
              />
            </Inspector>
          </Recipe>
          <h2>Opaque tag and status contrast</h2>
          {SURFACES.map((surface) => (
            <div
              key={surface}
              data-gallery-contrast-surface={surface}
              style={{ ...row, padding: 24, background: `var(--op-${surface})` }}
            >
              {TYPES.map((type) => (
                <div key={type} data-gallery-contrast={`type-${type}`} data-surface={surface}>
                  <ArtifactTag type={type} surface={surface}>
                    {type.toUpperCase()}
                  </ArtifactTag>
                </div>
              ))}
              {STATUSES.map((status) => (
                <div key={status} data-gallery-contrast={`status-${status}`} data-surface={surface}>
                  <ArtifactStatus status={status} surface={surface} />
                </div>
              ))}
            </div>
          ))}
        </section>
      </fieldset>
      <section data-gallery-artboard="States" style={stack}>
        <h1 style={{ font: 'var(--pc-type-display)' }}>{sourceHeading(states)}</h1>
        <div style={grid}>
          {stateTiles.map((tile, index) => (
            <StateTile
              key={tile.id}
              source={states}
              tile={tile}
              state={panelStates[index]}
              disabled={disabled}
              onClear={() => setFilter('')}
              onCopy={copy}
            />
          ))}
        </div>
      </section>
      <span role="status" className="pc-visually-hidden">
        {announcement}
      </span>
    </main>
  );
}
