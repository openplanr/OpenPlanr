import { useId, useState } from 'react';
import type { DashboardConnection } from '../../app/providers.js';
import {
  Badge,
  Button,
  Card,
  CommandHint,
  StatePanel,
  Tabs,
} from '../../design-system/components/index.js';
import type { DashboardBootstrap } from '../../lib/api/bootstrap.js';
import { type DiagnosticFinding, resolveCompatibilityDiagnostics } from './compatibility-model.js';
import { DataHealth, type DataHealthRead } from './DataHealth.js';
import { SupportSummary } from './SupportSummary.js';
import './diagnostics.css';

export type CompatibilityPageProps = Readonly<{
  embeddedBuildId: string;
  bootstrap: DashboardBootstrap | null;
  bootPhase: 'checking' | 'compatible' | 'incompatible' | 'unavailable';
  bootDetail: string | null;
  connection: DashboardConnection;
  onReturn?: () => void;
  dataHealth?: DataHealthRead | null;
}>;

function statusLabel(status: DiagnosticFinding['status']): string {
  if (status === 'pass') return 'Pass';
  if (status === 'warn') return 'Attention';
  if (status === 'pending') return 'Checking';
  return 'Fail';
}

function headline(findings: readonly DiagnosticFinding[]): {
  title: string;
  description: string;
  state: 'incompatible' | 'booting' | 'ready-to-resume';
} {
  if (findings.some((entry) => entry.status === 'fail')) {
    return {
      state: 'incompatible',
      title: 'Dashboard compatibility needs attention',
      description:
        'OpenPlanr certified at least one installation, package, or API problem. Mutation and durable work remain unavailable until remediation.',
    };
  }
  if (findings.some((entry) => entry.status === 'pending')) {
    return {
      state: 'booting',
      title: 'Checking dashboard compatibility',
      description: 'Diagnostics remain read-only while bootstrap custody is verified.',
    };
  }
  if (findings.some((entry) => entry.status === 'warn')) {
    return {
      state: 'ready-to-resume',
      title: 'Dashboard is usable with certified limitations',
      description:
        'Core navigation remains available, but one or more optional capabilities or live-update channels need attention.',
    };
  }
  return {
    state: 'ready-to-resume',
    title: 'Dashboard compatibility is certified',
    description:
      'Installed assets, API versions, and optional dependencies match the served bootstrap contract.',
  };
}

export function CompatibilityPage({
  embeddedBuildId,
  bootstrap,
  bootPhase,
  bootDetail,
  connection,
  onReturn,
  dataHealth = null,
}: CompatibilityPageProps) {
  const [tab, setTab] = useState('compatibility');
  const panelId = useId();
  const findings = resolveCompatibilityDiagnostics({
    embeddedBuildId,
    bootstrap,
    bootPhase,
    bootDetail,
    connection,
  });
  const summary = headline(findings);

  return (
    <section
      className="op-workspace op-diagnostics"
      data-route-kind="system.diagnostics"
      aria-labelledby="dashboard-diagnostics-title"
    >
      <header className="op-diagnostics__header">
        <div>
          <p className="op-eyebrow">Diagnostics</p>
          <h1 id="dashboard-diagnostics-title">Compatibility and installation checks</h1>
          <p>
            These checks explain why the dashboard can or cannot present durable Planning and
            Operate state. They never infer authority, repair packages, or expose private
            installation paths.
          </p>
        </div>
        {onReturn ? <Button onClick={onReturn}>Return to dashboard</Button> : null}
      </header>

      <Tabs
        label="Diagnostics sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'compatibility', label: 'Compatibility', panelId: `${panelId}-compatibility` },
          { id: 'health', label: 'Data health · Proposed', panelId: `${panelId}-health` },
          { id: 'recovery', label: 'Recovery', panelId: `${panelId}-recovery` },
          { id: 'support', label: 'Support summary', panelId: `${panelId}-support` },
        ]}
      />
      <section
        id={`${panelId}-compatibility`}
        role="tabpanel"
        hidden={tab !== 'compatibility'}
        aria-label="Compatibility checks"
      >
        <StatePanel
          state={summary.state}
          eyebrow="Current posture"
          title={summary.title}
          description={summary.description}
        />

        <section
          className="op-diagnostics__findings"
          aria-labelledby="dashboard-diagnostics-findings-title"
        >
          <div className="op-section-heading">
            <div>
              <p className="op-eyebrow">Certified checks</p>
              <h2 id="dashboard-diagnostics-findings-title">Boot through optional dependencies</h2>
            </div>
            <p>
              Each row is derived only from the public bootstrap envelope and current connection
              state.
            </p>
          </div>

          <ol className="op-diagnostics__list">
            {findings.map((entry) => (
              <li key={entry.category} data-diagnostic={entry.category} data-status={entry.status}>
                <article>
                  <header>
                    <p className="op-eyebrow">{entry.category.replaceAll('-', ' ')}</p>
                    <h3>{entry.title}</h3>
                    <Badge
                      tone={
                        entry.status === 'pass'
                          ? 'success'
                          : entry.status === 'fail'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {statusLabel(entry.status)}
                    </Badge>
                  </header>
                  <p>{entry.detail}</p>
                  <p className="op-diagnostics__remediation">
                    <strong>Next safe step:</strong> {entry.remediation}
                  </p>
                </article>
              </li>
            ))}
          </ol>
        </section>
      </section>
      <section
        id={`${panelId}-health`}
        role="tabpanel"
        hidden={tab !== 'health'}
        aria-label="Data health"
      >
        <DataHealth read={dataHealth} />
      </section>
      <section
        id={`${panelId}-recovery`}
        role="tabpanel"
        hidden={tab !== 'recovery'}
        aria-label="Recovery guidance"
      >
        <Card title="Resume the local dashboard">
          <p>
            Start the dashboard from the project folder. The last validated snapshot remains
            readable while the connection recovers.
          </p>
          <CommandHint command="openplanr dashboard" />
          <p>
            For package or API failures, follow the compatibility check's next safe step and verify
            the installation again.
          </p>
          <a href="#/operate/recovery">Open governed Operate recovery</a>
        </Card>
      </section>
      <section
        id={`${panelId}-support`}
        role="tabpanel"
        hidden={tab !== 'support'}
        aria-label="Support summary"
      >
        <SupportSummary embeddedBuildId={embeddedBuildId} bootstrap={bootstrap} />
      </section>

      <p className="op-authority-note">
        Diagnostics do not create arguments, authority, effects, repeated instructions, PLAN runs,
        or SHIP runs.
      </p>
    </section>
  );
}
