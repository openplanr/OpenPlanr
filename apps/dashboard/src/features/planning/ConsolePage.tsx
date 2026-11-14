import { useState } from 'react';
import { canonicalDashboardHref } from '../../app/router.js';
import {
  Absent,
  Button,
  CapabilityLabel,
  Card,
  CommandHint,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Prose,
  SectionHeader,
  Tabs,
  Toolbar,
  ToolbarDivider,
} from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import {
  CLI_COMMAND_GROUPS,
  PLANR_CAPABILITY_GROUPS,
  type PlanrCapability,
} from './console-catalog.js';
import './console.css';

const TOTAL = PLANR_CAPABILITY_GROUPS.reduce((sum, group) => sum + group.capabilities.length, 0);

function catalogueColumns(
  onCopy: ((text: string) => Promise<void>) | undefined,
  shortcuts: boolean,
  cli: boolean,
): readonly DataTableColumn<PlanrCapability>[] {
  return [
    {
      key: 'id',
      label: cli ? 'Command' : 'Skill',
      width: 190,
      render: (row) =>
        cli ? (
          <span className="pc-console__command-name">{row.id}</span>
        ) : (
          <CapabilityLabel name={row.id} size="sm" />
        ),
    },
    { key: 'summary', label: 'Purpose', render: (row) => <Prose>{row.summary}</Prose> },
    {
      key: 'view',
      label: 'Dashboard',
      width: 132,
      render: (row) => {
        const href = row.view ? canonicalDashboardHref(row.view) : null;
        return href ? (
          <a className="pc-console__link" href={href}>
            {row.view}
          </a>
        ) : (
          <Absent />
        );
      },
    },
    {
      key: 'command',
      label: 'Invocation',
      width: 268,
      render: (row) => (
        <CommandHint command={row.command} size="sm" onCopy={onCopy} shortcutsEnabled={shortcuts} />
      ),
    },
  ];
}

function matches(capability: PlanrCapability, needle: string): boolean {
  return `${capability.id} ${capability.summary} ${capability.command}`
    .toLowerCase()
    .includes(needle);
}

export function ConsolePage() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('skills');
  const copy = usePlanningCopy();
  const shortcuts = usePlanningShortcuts();
  const columns = catalogueColumns(copy, shortcuts, tab === 'commands');
  const needle = query.trim().toLowerCase();
  const catalogue =
    tab === 'skills'
      ? PLANR_CAPABILITY_GROUPS
      : CLI_COMMAND_GROUPS.map((group) => ({ ...group, capabilities: group.commands }));
  const groups = catalogue
    .map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      capabilities: needle
        ? group.capabilities.filter((capability) => matches(capability, needle))
        : group.capabilities,
    }))
    .filter((group) => group.capabilities.length > 0);
  const shown = groups.reduce((sum, group) => sum + group.capabilities.length, 0);

  return (
    <div className="op-workspace op-planning pc-console" data-route-kind="planning.console">
      <SectionHeader
        eyebrow="Reference"
        title="Console"
        count={`${TOTAL} skills · ${CLI_COMMAND_GROUPS.reduce((sum, group) => sum + group.commands.length, 0)} CLI templates`}
        description="Find a skill or a verified CLI template. Copy text to your host or terminal; all actions here are copy only."
      />
      <Tabs
        label="Console catalogues"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'skills', label: 'Host skills' },
          { id: 'commands', label: 'CLI commands' },
        ]}
      />
      <p className="pc-console__note">
        {tab === 'skills'
          ? 'Skill invocations below use the Claude Code host spelling. Use your installed host’s equivalent invocation when working elsewhere.'
          : 'Replace placeholders before running a command. Scoped task status writers are unavailable; read the parent specification instead. Operate templates supplement its governed controls.'}
      </p>
      <Toolbar>
        <Input
          size="sm"
          icon="search"
          placeholder="Filter name, purpose or invocation"
          ariaLabel="Filter skills and commands"
          value={query}
          onChange={setQuery}
          width={320}
        />
        <ToolbarDivider />
        <span className="pc-console__shown">{shown} shown</span>
      </Toolbar>
      <div className="pc-console__catalog">
        {groups.length === 0 ? (
          <Card padding={0}>
            <EmptyState
              icon="search"
              title="No catalogue entries match this filter"
              description="Try a name, purpose or invocation."
              action={<Button onClick={() => setQuery('')}>Clear filter</Button>}
            />
          </Card>
        ) : (
          groups.map((group) => (
            <Card
              key={group.id}
              title={group.title}
              meta={String(group.capabilities.length)}
              padding={0}
            >
              <p className="pc-console__group-description">{group.description}</p>
              <DataTable
                compact
                columns={columns}
                rows={group.capabilities}
                caption={group.title}
              />
            </Card>
          ))
        )}
      </div>
      <p className="pc-console__note">
        Open Keyboard shortcuts in the top bar for help or to disable single-letter shortcuts.
      </p>
    </div>
  );
}
