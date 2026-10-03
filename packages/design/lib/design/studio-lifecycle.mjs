/** Inspect and stop only the local Studio service belonging to this design. */
import { join } from 'node:path';
import {
  listArtifactReviewServers,
  stopArtifactReviewServer,
} from '@openplanr/artifact/review-server.mjs';
import { currentDesign, readJson } from './document.mjs';

function localUrl(value, service, path) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === `http://127.0.0.1:${service.port}` &&
      !url.search &&
      !url.hash &&
      path.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function manageDesignStudio(
  file,
  { action = 'status', instanceId, env = process.env, fetchImpl = fetch } = {},
) {
  if (!['status', 'stop'].includes(action))
    throw new Error('Studio action must be status or stop.');
  if (
    instanceId !== undefined &&
    (typeof instanceId !== 'string' || !/^[A-Za-z0-9_-]{22}$/u.test(instanceId))
  )
    throw new Error('Studio requires a valid exact instance ID.');
  const current = currentDesign(file);
  const services = (await listArtifactReviewServers({ env, fetchImpl })).filter(
    (service) => service.kind === 'design' && service.projectRoot === current.root,
  );
  const launcher = readJson(join(current.root, '.design/server.json'), null);
  let service = services.find((value) => value.instanceId === (instanceId ?? launcher?.instanceId));
  if (instanceId !== undefined && !service)
    throw new Error(
      'That Studio instance is not owned by this design in the current state directory.',
    );
  const result = {
    ok: true,
    action: `design_studio_${action}`,
    documentId: current.document.id,
    revision: current.revision,
    verification: current.verification.status,
  };
  if (action === 'stop') {
    if (!service && services.length === 1) service = services[0];
    if (!service && services.length > 1)
      throw new Error(
        `Multiple owned Studio services need recovery. Run studio --action status, then stop an exact service with --instance-id. Owned instances: ${services.map((value) => value.instanceId).join(', ')}.`,
      );
    if (!service)
      return {
        ...result,
        status: 'stopped',
        notice: 'Studio is stopped. Open the design to start it again.',
      };
    const stopped = await stopArtifactReviewServer(service.instanceId, { env, fetchImpl });
    return {
      ...result,
      status: stopped.status,
      instanceId: service.instanceId,
      notice: 'Feedback and arrangement are saved. Open the design to start Studio again.',
    };
  }
  if (!service)
    return {
      ...result,
      status: services.length ? 'attention' : 'stopped',
      services,
      notice: services.length
        ? services.length === 1
          ? 'Stop this design’s owned Studio service, then open the design again to restore its session link.'
          : 'Stop an exact owned Studio service with --instance-id, then reopen after all obsolete services are stopped.'
        : 'Open the design to start Studio.',
    };
  const url =
    localUrl(launcher?.studioUrl, service, /^\/studio\/[A-Za-z0-9._-]+\/$/u) ?? service.url;
  let browserStatus = 'not-checked';
  const privateUrl = localUrl(launcher?.url, service, /^\/r\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/$/u);
  if (privateUrl) {
    try {
      const response = await fetchImpl(`${privateUrl}api/design-status`, {
        signal: AbortSignal.timeout(700),
      });
      const data = await response.json();
      if (
        response.ok &&
        data.documentId === current.document.id &&
        data.revision === current.revision &&
        ['loading', 'ready', 'failed'].includes(data.status)
      )
        browserStatus = data.status;
    } catch {
      // Service health and observed browser readiness are separate states.
    }
  }
  return {
    ...result,
    status: 'running',
    instanceId: service.instanceId,
    url,
    browserStatus,
    services,
  };
}
