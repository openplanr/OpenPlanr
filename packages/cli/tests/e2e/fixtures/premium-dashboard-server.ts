import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanningBinding } from '../../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  buildPremiumDashboardFixture,
  type FixtureDataset,
  fixturePatch,
  fixtureSnapshot,
} from '../../dashboard/fixtures/premium-dashboard-fixtures.js';

const PRODUCTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist/dashboard');
const states = new Map<FixtureDataset, ReturnType<typeof createState>>();

function createState(dataset: FixtureDataset, binding: PlanningBinding) {
  const fixture = buildPremiumDashboardFixture(dataset);
  return {
    fixture,
    snapshot: fixtureSnapshot(fixture.graph, binding),
    streams: new Set<ServerResponse>(),
  };
}

function datasetFrom(url: URL): FixtureDataset | null {
  const dataset = url.searchParams.get('dataset');
  if (dataset === null) return null;
  if (dataset !== 'representative' && dataset !== 'artboard' && dataset !== 'scaling')
    throw new TypeError('Invalid dashboard dataset.');
  return dataset;
}

export function premiumRequestState(request: IncomingMessage, binding: PlanningBinding) {
  const dataset = datasetFrom(new URL(request.headers.referer ?? 'http://fixture.invalid'));
  if (!dataset) return null;
  let state = states.get(dataset);
  if (!state) {
    state = createState(dataset, binding);
    states.set(dataset, state);
  }
  return state;
}

export function productionManifest() {
  return JSON.parse(readFileSync(resolve(PRODUCTION_ROOT, 'dashboard-manifest.json'), 'utf8')) as {
    buildId: string;
    assets: string[];
    assetDigests: Record<string, { sha256: string }>;
  };
}

export function servePremiumFixture(
  request: IncomingMessage,
  response: ServerResponse,
  binding: PlanningBinding,
): boolean {
  const url = new URL(request.url ?? '/', 'http://fixture.invalid');
  if (url.pathname.startsWith('/__fixture/')) {
    const dataset = datasetFrom(url);
    if (!dataset) throw new TypeError('A dataset is required.');
    let state = states.get(dataset);
    if (url.pathname === '/__fixture/reset' && request.method === 'POST') {
      if (state) for (const stream of state.streams) stream.end();
      state = createState(dataset, binding);
      states.set(dataset, state);
    } else if (url.pathname === '/__fixture/patch' && request.method === 'POST' && state) {
      if (state.streams.size === 0) throw new Error('No Planning SSE consumer is connected.');
      const next = fixturePatch(state.snapshot, state.fixture.manifest.selectedId);
      state.snapshot = next.snapshot;
      for (const stream of state.streams)
        stream.write(`event: patch\ndata: ${JSON.stringify(next.event)}\n\n`);
    } else if (url.pathname !== '/__fixture/state' || request.method !== 'GET' || !state) {
      throw new TypeError('Invalid fixture control request.');
    }
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.end(
      JSON.stringify({
        manifest: state.fixture.manifest,
        manifestHash: state.fixture.manifestHash,
        cursor: state.snapshot.cursor,
        graphCounts: {
          nodes: state.snapshot.graph.nodes.length,
          edges: state.snapshot.graph.edges.length,
        },
      }),
    );
    return true;
  }
  if (!url.pathname.startsWith('/__production/')) return false;
  if (request.method !== 'GET') throw new TypeError('Production fixture assets are GET-only.');
  const asset = url.pathname.slice('/__production/'.length) || 'index.html';
  const manifest = productionManifest();
  if (asset !== 'index.html' && !manifest.assets.includes(asset))
    throw new TypeError('Unknown production asset.');
  const bytes = readFileSync(resolve(PRODUCTION_ROOT, asset));
  const expected = manifest.assetDigests[asset]?.sha256;
  if (!expected) throw new Error('Production asset has no build digest.');
  if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== expected)
    throw new Error('Production asset digest changed.');
  response.setHeader(
    'content-type',
    asset.endsWith('.html')
      ? 'text/html'
      : asset.endsWith('.js')
        ? 'text/javascript'
        : asset.endsWith('.css')
          ? 'text/css'
          : asset.endsWith('.woff2')
            ? 'font/woff2'
            : 'application/octet-stream',
  );
  response.setHeader('cache-control', 'no-store');
  response.end(bytes);
  return true;
}
