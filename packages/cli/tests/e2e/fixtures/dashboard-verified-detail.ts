import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

export function registerVerifiedDetailTest() {
  test('opens verified task content from a CLI graph with structured preserve entries', async ({
    page,
  }, info) => {
    const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
    const pipeline =
      process.env.OPENPLANR_PACKED_PIPELINE_ROOT ??
      dirname(createRequire(import.meta.url).resolve('planr-pipeline/package.json'));
    const { startDashboard } = await import(
      pathToFileURL(join(pipeline, 'lib/dashboard/index.mjs')).href
    );
    const project = info.outputPath('project');
    cpSync(join(workspace, 'packages/pipeline/conformance/fixtures/dashboard-graph'), project, {
      recursive: true,
    });
    const planrDir = join(project, '.planr');
    const task = join(planrDir, 'specs/SPEC-001-checkout/tasks/T-003-refund-flow.md');
    writeFileSync(
      task,
      readFileSync(task, 'utf8').replace(
        'title:',
        'preserve: [{"repositoryKey":"project","path":"src/a, b.ts"}]\ntitle:',
      ),
    );
    const graph: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          createRequire(import.meta.url).resolve('tsx/cli'),
          join(workspace, 'packages/cli/src/cli/index.ts'),
          '--project-dir',
          project,
          'graph',
          '--json',
        ],
        { encoding: 'utf8' },
      ),
    );
    const server = startDashboard({
      planrDir,
      watch: false,
      planningActorId: 'fixture-user',
      staticRoot: join(workspace, 'apps/dashboard/dist'),
      getGraph: () => graph,
    });
    const port = await server.listen(0, { env: { PLANR_HOME: info.outputPath('state') } });
    try {
      await page.goto(`http://127.0.0.1:${port}/#/list`);
      await page.getByText('Refund flow', { exact: true }).first().click();
      const content = page.getByText(/Blocked task depending on T-002/).first();
      await expect(content).toBeVisible();
      await page.getByRole('button', { name: 'Open full page' }).click();
      await expect(page).toHaveURL(/#\/detail\/SPEC-001%2FT-003$/);
      await expect(content).toBeVisible();
    } finally {
      await page.goto('about:blank');
      await server.close();
    }
  });
}
