import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import { verifyWorkspaceSignature } from '../lib/artifact/diagram/workspace-client.mjs';

/** In-memory capability service with real authentication and signatures for owner tests. */
export function diagramWorkspaceService() {
  const state = {
    revisions: new Map(),
    events: [],
    requests: [],
    operations: new Map(),
    failAfter: false,
    conflictNext: false,
  };
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.split('/').filter(Boolean);
    const id = path[3],
      route = path[4],
      body = init.body && JSON.parse(init.body);
    state.requests.push({ url, method: init.method ?? 'GET', body });
    const response = (value, status = 200) => {
      if (state.failAfter) {
        state.failAfter = false;
        throw new Error('Receipt lost');
      }
      return Response.json(structuredClone(value), { status });
    };
    const authorization = init.headers?.Authorization?.slice(7);
    if (init.method === 'PUT') {
      if (
        !(await verifyWorkspaceSignature(body, body.ownerPublicKey)) ||
        sha256Hex(authorization) !== body.ownerAuthHash
      )
        return response({}, 403);
      if (state.workspace) {
        if (canonicalizeJson(body) !== canonicalizeJson(state.create)) return response({}, 409);
        return response(state.workspace);
      }
      state.create = structuredClone(body);
      state.workspace = {
        schemaVersion: body.schemaVersion,
        id,
        version: 1,
        epoch: 1,
        currentRevision: body.revision.id,
        commentsPaused: false,
        ownerPublicKey: body.ownerPublicKey,
        keyring: body.keyring,
      };
      state.reviewerAuthHash = body.reviewerAuthHash;
      state.revisions.set(body.revision.id, structuredClone(body.revision));
      return response(state.workspace);
    }
    if (!state.workspace || state.deleted) return response({}, 404);
    const owner = sha256Hex(authorization ?? '') === state.create.ownerAuthHash;
    if (!owner && sha256Hex(authorization ?? '') !== state.reviewerAuthHash)
      return response({}, 401);
    if (state.revoked && route !== 'manage') return response({}, 410);
    if (route === 'events' && init.method === 'POST') {
      if (state.workspace.commentsPaused) return response({}, 403);
      const revision = state.revisions.get(body.revisionId);
      if (
        !revision ||
        body.revisionId !== state.workspace.currentRevision ||
        body.reviewOf !== revision.reviewOf
      )
        return response({}, 409);
      if (!(await verifyWorkspaceSignature(body, body.publicKey))) return response({}, 403);
      const previous = state.events.find(({ event }) => event.id === body.id);
      if (previous)
        return canonicalizeJson(previous.event) === canonicalizeJson(body)
          ? response(previous)
          : response({}, 409);
      const receipt = { sequence: state.events.length + 1, event: structuredClone(body) };
      state.events.push(receipt);
      return response(receipt);
    }
    if (init.method === 'POST') {
      if (!owner || !(await verifyWorkspaceSignature(body, state.workspace.ownerPublicKey)))
        return response({}, 403);
      if (state.operations.has(body.operationId))
        return response(state.operations.get(body.operationId));
      if (state.conflictNext) {
        state.conflictNext = false;
        state.workspace.version++;
        return response({}, 409);
      }
      if (body.expectedVersion !== state.workspace.version) return response({}, 409);
      state.workspace.version++;
      if (route === 'publish') {
        state.revisions.set(body.revision.id, structuredClone(body.revision));
        state.workspace.currentRevision = body.revision.id;
      } else if (route === 'rotate') {
        Object.assign(state.workspace, { epoch: body.epoch, keyring: body.keyring });
        state.reviewerAuthHash = body.reviewerAuthHash;
      } else if (route === 'manage') {
        if (body.action === 'pause' || body.action === 'resume')
          state.workspace.commentsPaused = body.action === 'pause';
        if (body.action === 'revoke') state.revoked = true;
        if (body.action === 'delete') state.deleted = true;
      } else return response({}, 404);
      const receipt = state.deleted
        ? { schemaVersion: '1.0.0', id, deleted: true }
        : structuredClone(state.workspace);
      state.operations.set(body.operationId, receipt);
      return response(receipt);
    }
    if (route === 'events') {
      const after = Number(new URL(url).searchParams.get('after') ?? 0);
      const events = state.events.filter((event) => event.sequence > after).slice(0, 100);
      const cursor = events.at(-1)?.sequence ?? after;
      return response({ events, cursor, hasMore: state.events.length > cursor });
    }
    if (route === 'revisions') {
      if (path[5])
        return state.revisions.has(path[5])
          ? response(state.revisions.get(path[5]))
          : response({}, 404);
      return response({
        revisions: [...state.revisions.values()].map(({ id, epoch, createdAt, reviewOf }) => ({
          id,
          epoch,
          createdAt,
          reviewOf,
        })),
        cursor: '',
        hasMore: false,
      });
    }
    return response(state.workspace);
  };
  return { state, fetchImpl };
}
