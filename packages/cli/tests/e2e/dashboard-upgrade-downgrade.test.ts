// @vitest-environment node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installedOpenPlanrDashboardRoot } from '../../src/cli/commands/operate.js';
import { installPackedPipeline, type PackedPipelineInstall } from './helpers/installed-pipeline.js';

const dashboardRoot = installedOpenPlanrDashboardRoot();
let pipeline: PackedPipelineInstall;

beforeAll(async () => {
  pipeline = await installPackedPipeline();
}, 120_000);

afterAll(() => pipeline?.cleanup());

type BootstrapBody = {
  compatibility: { status: string; reasonCodes?: string[] };
  ui?: { buildId?: string };
};

function httpGet(port: number, path: string) {
  return new Promise<{ status: number; body: string }>((resolveRequest, rejectRequest) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { accept: 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolveRequest({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', rejectRequest);
    req.end();
  });
}

async function createServer(options: Record<string, unknown>) {
  return pipeline.startDashboard(options);
}

function directoryDigest(root: string): string {
  const hash = createHash('sha256');

  function visit(directory: string, prefix = ''): void {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = join(directory, name);
      const relativePath = prefix === '' ? name : `${prefix}/${name}`;
      const stats = statSync(absolutePath);
      hash.update(relativePath);
      hash.update('\0');
      if (stats.isDirectory()) {
        hash.update('directory\0');
        visit(absolutePath, relativePath);
      } else {
        hash.update('file\0');
        hash.update(readFileSync(absolutePath));
        hash.update('\0');
      }
    }
  }

  visit(root);
  return hash.digest('hex');
}

describe('dashboard upgrade and downgrade matrix', () => {
  it('supports the current unified build with a matching dashboardBuildId', async () => {
    expect(existsSync(dashboardRoot), 'run npm run build before upgrade/downgrade tests').toBe(
      true,
    );
    const manifest = JSON.parse(
      readFileSync(join(dashboardRoot, 'dashboard-manifest.json'), 'utf8'),
    ) as {
      buildId: string;
    };

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-upgrade-'));
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(join(planrDir, 'config.json'), JSON.stringify({ projectName: 'Upgrade matrix' }));

    const dashboard = await createServer({
      staticRoot: dashboardRoot,
      dashboardBuildId: manifest.buildId,
      planrDir,
      watch: false,
    });

    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const bootstrap = await httpGet(port, '/api/bootstrap');
      const body = JSON.parse(bootstrap.body) as BootstrapBody;
      expect(body.compatibility.status).toBe('compatible');
      expect(body.ui?.buildId).toBe(manifest.buildId);
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the advertised build id does not match the installed manifest', async () => {
    expect(existsSync(dashboardRoot), 'run npm run build before upgrade/downgrade tests').toBe(
      true,
    );
    const manifest = JSON.parse(
      readFileSync(join(dashboardRoot, 'dashboard-manifest.json'), 'utf8'),
    ) as {
      buildId: string;
    };

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-downgrade-'));
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(
      join(planrDir, 'config.json'),
      JSON.stringify({ projectName: 'Downgrade matrix' }),
    );

    const dashboard = await createServer({
      staticRoot: dashboardRoot,
      dashboardBuildId: `${manifest.buildId}-stale`,
      planrDir,
      watch: false,
    });

    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const bootstrap = await httpGet(port, '/api/bootstrap');
      const body = JSON.parse(bootstrap.body) as BootstrapBody;
      expect(body.compatibility.status).not.toBe('compatible');
      expect(body.compatibility.reasonCodes?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed for a legacy-only static root without a unified manifest', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-legacy-only-'));
    const legacyRoot = join(temporaryRoot, 'legacy');
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, 'index.html'), '<main>legacy</main>\n');

    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(join(planrDir, 'config.json'), JSON.stringify({ projectName: 'Legacy only' }));

    const dashboard = await createServer({
      staticRoot: legacyRoot,
      planrDir,
      watch: false,
    });

    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const bootstrap = await httpGet(port, '/api/bootstrap');
      const body = JSON.parse(bootstrap.body) as BootstrapBody;
      expect(body.compatibility.status).not.toBe('compatible');
      expect(body.compatibility.reasonCodes).toContain('DASHBOARD_MANIFEST_MISSING');
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('returns to the known unified build without mutating durable project bytes', async () => {
    expect(existsSync(dashboardRoot), 'run npm run build before rollback tests').toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(dashboardRoot, 'dashboard-manifest.json'), 'utf8'),
    ) as {
      buildId: string;
    };

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-rollback-'));
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(join(planrDir, 'specs', 'SPEC-001-example'), { recursive: true });
    writeFileSync(
      join(planrDir, 'config.json'),
      JSON.stringify({ projectName: 'Rollback custody' }),
    );
    writeFileSync(
      join(planrDir, 'specs', 'SPEC-001-example', 'SPEC-001-example.md'),
      '# Durable planning state\n',
    );
    const before = directoryDigest(planrDir);

    async function readCompatibility(dashboardBuildId: string) {
      const dashboard = await createServer({
        staticRoot: dashboardRoot,
        dashboardBuildId,
        planrDir,
        watch: false,
      });
      try {
        const port = await dashboard.listen(0, {
          env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
        });
        const response = await httpGet(port, '/api/bootstrap');
        expect(directoryDigest(planrDir)).toBe(before);
        return JSON.parse(response.body) as BootstrapBody;
      } finally {
        await dashboard.close();
      }
    }

    try {
      const current = await readCompatibility(manifest.buildId);
      expect(current.compatibility.status).toBe('compatible');

      const incompatible = await readCompatibility(`${manifest.buildId}-unsupported`);
      expect(incompatible.compatibility.status).not.toBe('compatible');

      const rolledBack = await readCompatibility(manifest.buildId);
      expect(rolledBack.compatibility.status).toBe('compatible');
      expect(rolledBack.ui?.buildId).toBe(manifest.buildId);
      expect(directoryDigest(planrDir)).toBe(before);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
