import type { DashboardConnection } from '../../app/providers.js';
import { StatePanel } from '../../design-system/components/index.js';
import type { DashboardBootstrap } from '../../lib/api/bootstrap.js';
import { type DiagnosticFinding, resolveCompatibilityDiagnostics } from './compatibility-model.js';
import { SupportSummary } from './SupportSummary.js';
import './diagnostics.css';

export type CompatibilityPageProps = Readonly<{
  embeddedBuildId: string;
  bootstrap: DashboardBootstrap | null;
  bootPhase: 'checking' | 'compatible' | 'incompatible' | 'unavailable';
  bootDetail: string | null;
  connection: DashboardConnection;
  onReturn?: () => void;
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

/** Read-only diagnostics for boot, package, API, watcher, and optional-dependency posture. */
export function CompatibilityPage({
  embeddedBuildId,
  bootstrap,
  bootPhase,
  bootDetail,
  connection,
  onReturn,
}: CompatibilityPageProps) {
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
        {onReturn ? (
          <button type="button" className="op-inline-action" onClick={onReturn}>
            Return to dashboard
          </button>
        ) : null}
      </header>

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
                  <span className="op-diagnostics__status">{statusLabel(entry.status)}</span>
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

      <SupportSummary embeddedBuildId={embeddedBuildId} bootstrap={bootstrap} />

      <p className="op-authority-note">
        Diagnostics do not create arguments, authority, effects, repeated instructions, PLAN runs,
        or SHIP runs.
      </p>
    </section>
  );
}
