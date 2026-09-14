import { useState } from 'react';
import { canonicalDashboardHref } from '../../app/router.js';
import {
  Absent,
  CapabilityLabel,
  Card,
  CommandHint,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Prose,
  SectionHeader,
  Toolbar,
  ToolbarDivider,
} from '../../design-system/components/index.js';
import { PLANR_CAPABILITY_GROUPS, type PlanrCapability } from './console-catalog.js';
import './console.css';

const TOTAL = PLANR_CAPABILITY_GROUPS.reduce((sum, group) => sum + group.capabilities.length, 0);

const columns: readonly DataTableColumn<PlanrCapability>[] = [
  {
    key: 'id',
    label: 'Skill',
    width: 190,
    render: (row) => <CapabilityLabel name={row.id} size="sm" />,
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
    render: (row) => <CommandHint command={row.command} size="sm" />,
  },
];

function matches(capability: PlanrCapability, needle: string): boolean {
  return `${capability.id} ${capability.summary}`.toLowerCase().includes(needle);
}

export function ConsolePage() {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const groups = PLANR_CAPABILITY_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    capabilities: needle
      ? group.capabilities.filter((capability) => matches(capability, needle))
      : group.capabilities,
  })).filter((group) => group.capabilities.length > 0);
  const shown = groups.reduce((sum, group) => sum + group.capabilities.length, 0);

  return (
    <div className="op-workspace op-planning pc-console" data-route-kind="planning.console">
      <SectionHeader
        eyebrow="planr-dashboard · console"
        title="Console"
        count={`${TOTAL} skills`}
        description="The static catalog of planr-* skills, in their shipped groups. Reference only — the console cannot invoke them."
      />
      <Toolbar>
        <Input
          size="sm"
          icon="search"
          placeholder="Filter skills"
          ariaLabel="Filter skills"
          value={query}
          onChange={setQuery}
          width={220}
        />
        <ToolbarDivider />
        <span className="pc-console__shown">{shown} shown</span>
      </Toolbar>
      <div className="pc-console__catalog">
        {groups.length === 0 ? (
          <Card padding={0}>
            <EmptyState
              icon="search"
              title="No skill matches this filter"
              description="Filter by skill name or purpose."
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
    </div>
  );
}
