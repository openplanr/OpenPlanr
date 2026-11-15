import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { dashboardFixtureServerPlugin } from '../e2e/fixtures/dashboard-fixture-server.mjs';

vi.mock('../e2e/fixtures/premium-dashboard-server.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../e2e/fixtures/premium-dashboard-server.js')>();
  return { ...original, productionManifest: () => ({ buildId: 'production-fixture' }) };
});

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

async function fixtureRead(path: string, scenario: '1' | 'empty', production = false) {
  let middleware: Middleware | undefined;
  dashboardFixtureServerPlugin().configureServer({
    middlewares: {
      use: (handler: Middleware) => {
        middleware = handler;
      },
    },
  });
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    if (!middleware) return reject(new Error('Missing fixture middleware.'));
    const response = {
      statusCode: 200,
      setHeader: () => {},
      end: (body: string) => resolve({ status: response.statusCode, body: JSON.parse(body) }),
    };
    middleware(
      {
        url: path,
        method: 'GET',
        headers: {
          referer: `http://fixture.invalid/${production ? '__production/' : ''}?localOperate=${scenario}`,
        },
      } as IncomingMessage,
      response as unknown as ServerResponse,
      () => reject(new Error('Fixture read was not handled.')),
    );
  });
}

describe('first-run Operate browser fixture', () => {
  it.each([false, true])(
    'returns the empty first-run contract with production=%s',
    async (production) => {
      const bootstrap = await fixtureRead('/api/bootstrap', 'empty', production);
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.body).toMatchObject({
        queryRoots: { operate: null },
        capabilities: { operateCommands: { available: false } },
      });
      if (production)
        expect(bootstrap.body.ui).toMatchObject({
          buildId: 'production-fixture',
          expectedBuildId: 'production-fixture',
        });
      for (const pageSize of ['1', '12']) {
        const index = await fixtureRead(
          `/api/operate/local-reviews?page=1&pageSize=${pageSize}`,
          'empty',
          production,
        );
        expect(index.status).toBe(200);
        expect(index.body).toMatchObject({
          kind: 'local-operate-review-index',
          pagination: { total: 0 },
          items: [],
        });
      }
    },
  );

  it('preserves the completed-review scenario', async () => {
    const index = await fixtureRead('/api/operate/local-reviews?page=1&pageSize=12', '1');
    expect(index.status).toBe(200);
    expect(index.body.pagination).toMatchObject({ total: 1 });
    expect(index.body.items).toHaveLength(1);
  });
});
