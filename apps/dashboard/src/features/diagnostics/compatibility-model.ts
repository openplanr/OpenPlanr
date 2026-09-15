import type { DashboardConnection } from '../../app/providers.js';
import type { DashboardBootstrap, DashboardBootstrapReason } from '../../lib/api/bootstrap.js';

export type DiagnosticCategory =
  | 'boot'
  | 'incompatible-installation'
  | 'missing-asset'
  | 'stale-package'
  | 'api-version'
  | 'watcher-gap'
  | 'optional-dependency';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'pending';

export type DiagnosticFinding = Readonly<{
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  title: string;
  detail: string;
  remediation: string;
}>;

const CATEGORY_ORDER: readonly DiagnosticCategory[] = Object.freeze([
  'boot',
  'incompatible-installation',
  'missing-asset',
  'stale-package',
  'api-version',
  'watcher-gap',
  'optional-dependency',
]);

const REASON_CATEGORY: Readonly<Record<DashboardBootstrapReason, DiagnosticCategory>> =
  Object.freeze({
    DASHBOARD_MANIFEST_MISSING: 'incompatible-installation',
    DASHBOARD_MANIFEST_INVALID: 'api-version',
    DASHBOARD_ASSET_MISSING: 'missing-asset',
    DASHBOARD_BUILD_MISMATCH: 'stale-package',
  });

function finding(
  category: DiagnosticCategory,
  status: DiagnosticStatus,
  title: string,
  detail: string,
  remediation: string,
): DiagnosticFinding {
  return Object.freeze({ category, status, title, detail, remediation });
}

function bootFinding(phase: 'checking' | 'failed', detail: string): DiagnosticFinding {
  return finding(
    'boot',
    phase === 'checking' ? 'pending' : 'fail',
    phase === 'checking' ? 'Verifying dashboard bootstrap' : 'Bootstrap could not be certified',
    detail,
    phase === 'checking'
      ? 'Wait for OpenPlanr to publish the public bootstrap envelope.'
      : 'Restore the loopback connection, then reopen diagnostics without mutation.',
  );
}

function pass(category: DiagnosticCategory, title: string, detail: string): DiagnosticFinding {
  return finding(category, 'pass', title, detail, 'No remediation is required for this check.');
}

function fail(
  category: DiagnosticCategory,
  title: string,
  detail: string,
  remediation: string,
): DiagnosticFinding {
  return finding(category, 'fail', title, detail, remediation);
}

function warn(
  category: DiagnosticCategory,
  title: string,
  detail: string,
  remediation: string,
): DiagnosticFinding {
  return finding(category, 'warn', title, detail, remediation);
}

export function resolveCompatibilityDiagnostics(
  input: Readonly<{
    embeddedBuildId: string;
    bootstrap: DashboardBootstrap | null;
    bootPhase: 'checking' | 'compatible' | 'incompatible' | 'unavailable';
    bootDetail: string | null;
    connection: DashboardConnection;
  }>,
): readonly DiagnosticFinding[] {
  const findings = new Map<DiagnosticCategory, DiagnosticFinding>();

  if (input.bootPhase === 'checking') {
    findings.set(
      'boot',
      bootFinding('checking', input.bootDetail ?? 'Bootstrap request is in flight.'),
    );
  } else if (input.bootPhase === 'unavailable') {
    findings.set(
      'boot',
      bootFinding(
        'failed',
        input.bootDetail ?? 'OpenPlanr did not return a validated bootstrap envelope.',
      ),
    );
  } else {
    findings.set(
      'boot',
      pass(
        'boot',
        'Bootstrap envelope validated',
        'The public bootstrap response matched the installed dashboard build contract.',
      ),
    );
  }

  const bootstrap = input.bootstrap;
  const reasonCodes = bootstrap?.compatibility.reasonCodes ?? [];
  const reasonCategories = new Set(reasonCodes.map((reason) => REASON_CATEGORY[reason]));

  if (!bootstrap || bootstrap.compatibility.status === 'incompatible' || reasonCodes.length > 0) {
    findings.set(
      'incompatible-installation',
      fail(
        'incompatible-installation',
        'Dashboard installation is incompatible',
        reasonCodes.length > 0
          ? `Certified reason codes: ${reasonCodes.join(' · ')}.`
          : 'OpenPlanr refused the installed dashboard before presenting project data.',
        'Install matching OpenPlanr dashboard assets, then verify compatibility again.',
      ),
    );
  } else {
    findings.set(
      'incompatible-installation',
      pass(
        'incompatible-installation',
        'Installation contract is compatible',
        'The UI, server, and packaged assets satisfy one compatible build contract.',
      ),
    );
  }

  findings.set(
    'missing-asset',
    reasonCategories.has('missing-asset')
      ? fail(
          'missing-asset',
          'Packaged asset is missing',
          'At least one dashboard asset required by the build manifest is absent.',
          'Reinstall the dashboard package or rebuild the embedded asset manifest.',
        )
      : pass(
          'missing-asset',
          'Packaged assets resolve',
          'Every asset entry required by the certified manifest is present.',
        ),
  );

  const buildMismatch =
    reasonCategories.has('stale-package') ||
    (bootstrap !== null &&
      bootstrap.ui.buildId !== null &&
      bootstrap.ui.expectedBuildId !== null &&
      bootstrap.ui.buildId !== bootstrap.ui.expectedBuildId);
  findings.set(
    'stale-package',
    buildMismatch
      ? fail(
          'stale-package',
          'Installed build does not match the server expectation',
          bootstrap
            ? `Embedded build ${input.embeddedBuildId} differs from the served build ${bootstrap.ui.buildId ?? 'unknown'}.`
            : 'The embedded dashboard build identity could not be reconciled with the server.',
          'Install the dashboard build expected by this OpenPlanr server, then reload diagnostics.',
        )
      : pass(
          'stale-package',
          'Build custody matches',
          `Embedded and served builds both report ${input.embeddedBuildId}.`,
        ),
  );

  findings.set(
    'api-version',
    reasonCategories.has('api-version')
      ? fail(
          'api-version',
          'API or manifest version is unsupported',
          'The dashboard manifest or protocol envelope failed semantic validation.',
          'Upgrade OpenPlanr to a release that publishes a supported dashboard contract.',
        )
      : pass(
          'api-version',
          'API versions are supported',
          bootstrap
            ? `Protocol ${bootstrap.protocolVersion} with Operate ${bootstrap.capabilities.operateExperience.protocolVersion} and Planning graph ${bootstrap.capabilities.planningGraph.schemaVersion}.`
            : 'Protocol versions remain unproven until bootstrap succeeds.',
        ),
  );

  const watcherGap =
    input.connection.state === 'stale' ||
    input.connection.state === 'offline' ||
    input.connection.reason.toLowerCase().includes('watch');
  findings.set(
    'watcher-gap',
    watcherGap
      ? warn(
          'watcher-gap',
          'Live reconciliation may be unavailable',
          input.connection.reason,
          'Restore the loopback connection or restart the dashboard without --no-watch before relying on live updates.',
        )
      : pass('watcher-gap', 'Live update channel is available', input.connection.label),
  );

  const optionalDependencyGap =
    bootstrap !== null &&
    (!bootstrap.capabilities.diagnostics.available ||
      !bootstrap.capabilities.operateCommands.available);
  findings.set(
    'optional-dependency',
    optionalDependencyGap
      ? warn(
          'optional-dependency',
          'Optional capability is unavailable',
          [
            !bootstrap?.capabilities.diagnostics.available ? 'diagnostics unavailable' : null,
            !bootstrap?.capabilities.operateCommands.available
              ? 'operate commands unavailable'
              : null,
          ]
            .filter((entry): entry is string => entry !== null)
            .join(' · '),
          'Reinstall OpenPlanr with optional dependencies enabled. Global navigation and diagnostics remain available.',
        )
      : pass(
          'optional-dependency',
          'Optional dependencies are present',
          'Diagnostics and governed Operate command transport are both advertised.',
        ),
  );

  return Object.freeze(
    CATEGORY_ORDER.map((category) => {
      const finding = findings.get(category);
      if (!finding) {
        throw new Error(`Missing compatibility finding for ${category}`);
      }
      return finding;
    }),
  );
}

export function connectionFromBootstrap(
  bootstrap: DashboardBootstrap | null,
  embeddedBuildId: string,
  bootDetail: string | null,
): DashboardConnection {
  if (!bootstrap) {
    return Object.freeze({
      state: 'booting',
      label: 'Checking local dashboard',
      reason: bootDetail ?? 'Waiting for OpenPlanr to return a validated project projection.',
    });
  }
  if (
    bootstrap.compatibility.status !== 'compatible' ||
    bootstrap.ui.buildId !== embeddedBuildId ||
    bootstrap.ui.expectedBuildId !== embeddedBuildId
  ) {
    return Object.freeze({
      state: 'incompatible',
      label: 'Dashboard installation is incompatible',
      reason:
        bootstrap.compatibility.reasonCodes.length > 0
          ? bootstrap.compatibility.reasonCodes.join(' · ')
          : 'Install matching OpenPlanr dashboard assets before relying on current operating state.',
    });
  }
  if (!bootstrap.capabilities.operateCommands.available) {
    return Object.freeze({
      state: 'read-only',
      label: 'Connected in read-only mode',
      reason:
        'Governed Operate commands are unavailable. Planning inspection and diagnostics remain available.',
    });
  }
  return Object.freeze({
    state: 'connected',
    label: 'Connected to local OpenPlanr',
    reason: 'Validated projection channel is available.',
  });
}

export function identityFromBootstrap(bootstrap: DashboardBootstrap | null): {
  projectName: string;
  projectDetail: string;
  actorLabel: string;
  bindingLabel: string;
} {
  if (!bootstrap) {
    return {
      projectName: 'OpenPlanr',
      projectDetail: 'Project context pending',
      actorLabel: 'Actor binding pending',
      bindingLabel: 'Scope and domain pending',
    };
  }
  return {
    projectName: bootstrap.project.name,
    projectDetail:
      bootstrap.project.products.length > 1 ? 'Planning and operations' : 'Project workspace',
    actorLabel: 'Actor binding pending',
    bindingLabel: 'Scope and domain pending',
  };
}
