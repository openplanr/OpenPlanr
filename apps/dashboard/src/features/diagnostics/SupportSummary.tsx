import type { DashboardBootstrap } from '../../lib/api/bootstrap.js';

const PRIVATE_PATH = /(?:^|[\s"'`])\/(?:Users|home|opt|var|private|tmp)\//iu;

export type SupportSummaryProps = Readonly<{
  embeddedBuildId: string;
  bootstrap: DashboardBootstrap | null;
}>;

function safeLine(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return 'Not returned';
  if (PRIVATE_PATH.test(value)) return 'Redacted';
  return value;
}

/** Presents only the access-safe support bundle certified by bootstrap custody. */
export function SupportSummary({ embeddedBuildId, bootstrap }: SupportSummaryProps) {
  const lines = [
    ['Embedded dashboard build', embeddedBuildId],
    ['Served dashboard build', safeLine(bootstrap?.ui.buildId)],
    ['Expected dashboard build', safeLine(bootstrap?.ui.expectedBuildId)],
    ['Asset manifest hash', safeLine(bootstrap?.ui.assetManifestHash)],
    ['OpenPlanr package version', safeLine(bootstrap?.server.packageVersion)],
    ['Bootstrap protocol', safeLine(bootstrap?.protocolVersion)],
    ['Planning graph schema', safeLine(bootstrap?.capabilities.planningGraph.schemaVersion)],
    [
      'Operate experience protocol',
      safeLine(bootstrap?.capabilities.operateExperience.protocolVersion),
    ],
    [
      'Operate commands transport',
      safeLine(bootstrap?.capabilities.operateCommands.transportVersion),
    ],
    [
      'Diagnostics capability',
      bootstrap?.capabilities.diagnostics.available ? 'available' : 'unavailable',
    ],
    [
      'Operate commands capability',
      bootstrap?.capabilities.operateCommands.available ? 'available' : 'unavailable',
    ],
    ['Compatibility status', safeLine(bootstrap?.compatibility.status)],
    [
      'Compatibility reasons',
      bootstrap?.compatibility.reasonCodes.length
        ? bootstrap.compatibility.reasonCodes.join(' · ')
        : 'None',
    ],
    ['Project name', safeLine(bootstrap?.project.name)],
    ['Project branch', safeLine(bootstrap?.project.branch)],
    ['Loopback origin', safeLine(bootstrap?.origin)],
  ] as const;

  const bundle = lines.map(([label, value]) => `${label}: ${value}`).join('\n');

  return (
    <section className="op-diagnostics__summary" aria-labelledby="dashboard-support-summary-title">
      <div className="op-section-heading">
        <div>
          <p className="op-eyebrow">Support bundle</p>
          <h2 id="dashboard-support-summary-title">Access-safe installation summary</h2>
        </div>
        <p>
          Only public bootstrap fields appear here. Private paths, bodies, and credentials never do.
        </p>
      </div>

      <dl aria-label="Support summary fields">
        {lines.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>

      <textarea
        className="op-diagnostics__bundle"
        readOnly
        aria-label="Support bundle text"
        value={bundle}
      />
    </section>
  );
}
