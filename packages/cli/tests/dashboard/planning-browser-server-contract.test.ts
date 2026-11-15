import { describe, expect, it } from 'vitest';
import {
  fetchPlanningDetail,
  fetchPlanningGraph,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { planningDetailIdentity } from '../../../../apps/dashboard/src/features/planning/use-planning-detail.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  createDashboardApiFixture,
  DASHBOARD_FIXTURE_ACTOR,
  DASHBOARD_FIXTURE_ORIGIN,
} from '../e2e/fixtures/dashboard-api-fixture.mjs';
import { dashboardFixtureServerPlugin } from '../e2e/fixtures/dashboard-fixture-server.mjs';
import { buildPremiumDashboardFixture } from './fixtures/premium-dashboard-fixtures.js';

type Request = { method: string; url: string; headers: Record<string, string> };
type Reply = {
  statusCode: number;
  setHeader: (name: string, value: string | number) => void;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
};
type Middleware = (request: Request, response: Reply, next: () => void) => void;

function fixtureTransport(referer: string) {
  const server: { handler?: Middleware } = {};
  dashboardFixtureServerPlugin().configureServer({
    middlewares: {
      use: (handler: Middleware) => {
        server.handler = handler;
      },
    },
  });
  const fetcher: typeof fetch = (input, init = {}) =>
    new Promise((resolve, reject) => {
      const url = new URL(String(input));
      const requestHeaders = new Headers(init.headers);
      const responseHeaders = new Headers();
      const response: Reply = {
        statusCode: 200,
        setHeader: (name, value) => responseHeaders.set(name, String(value)),
        writeHead(status, headers) {
          this.statusCode = status;
          for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
        },
        end(body) {
          resolve(new Response(body, { status: this.statusCode, headers: responseHeaders }));
        },
      };
      if (!server.handler) return reject(new Error('Fixture middleware was not installed.'));
      server.handler(
        {
          method: init.method ?? 'GET',
          url: `${url.pathname}${url.search}`,
          headers: { referer, 'x-openplanr-actor': requestHeaders.get('x-openplanr-actor') ?? '' },
        },
        response,
        () => reject(new Error('Planning request bypassed its fixture server.')),
      );
    });
  return fetcher;
}

const scenarios = [
  { name: 'quick delivery task', referer: '/?planningScenario=delivery', id: 'QT-071' },
  {
    name: 'scoped artboard task',
    referer: '/__production/?dataset=artboard',
    id: 'SPEC-026/T-112',
  },
  { name: 'artboard spec', referer: '/__production/?dataset=artboard', id: 'SPEC-026' },
  {
    name: 'representative inspector',
    referer: '/__production/?dataset=representative',
    id: buildPremiumDashboardFixture('representative').manifest.selectedId,
  },
];

describe('browser fixture Planning detail contract', () => {
  it.each(scenarios)(
    'serves a verified $name through the installed Pipeline handler',
    async ({ referer, id }) => {
      const source = createDashboardApiFixture().planning;
      const identity = createDashboardQueryIdentity({
        ...source.binding,
        productArea: 'planning',
        route: '#/list',
        subjectId: null,
        cycleId: null,
        eventHead: null,
        viewHash: null,
      });
      const fetcher = fixtureTransport(new URL(referer, DASHBOARD_FIXTURE_ORIGIN).href);
      const snapshot = await fetchPlanningGraph({
        origin: DASHBOARD_FIXTURE_ORIGIN,
        identity,
        fetcher,
      });
      const selected = snapshot.graph.nodes.find((node) => node.id === id);
      if (!selected) throw new Error('Fixture selection missing.');
      const detailIdentity = planningDetailIdentity(
        { binding: identity, envelope: snapshot },
        selected,
      );
      const detail = await fetchPlanningDetail({
        origin: DASHBOARD_FIXTURE_ORIGIN,
        identity: detailIdentity,
        nodeId: id,
        snapshot,
        fetcher,
      });
      expect(detail.subjectId).toBe(id);
      expect(detail.binding.actorId).toBe(DASHBOARD_FIXTURE_ACTOR);
      expect(detail.cursor).toEqual(snapshot.cursor);
      expect(detail.node).toEqual(snapshot.graph.nodes.find((node) => node.id === id));
      expect(detail.node).not.toHaveProperty('body');
      await expect(
        fetchPlanningDetail({
          origin: DASHBOARD_FIXTURE_ORIGIN,
          identity: createDashboardQueryIdentity({ ...detailIdentity, actorId: 'foreign-actor' }),
          snapshot,
          fetcher,
        }),
      ).rejects.toThrow();
    },
  );
});
