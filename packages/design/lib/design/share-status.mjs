/** Read owner-local attachment status without loading publishing or encryption clients. */
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { configuredPlanrHome, planrHome } from '@openplanr/artifact/internal/planr-home.mjs';
import { readCustody } from '@openplanr/artifact/owner-custody.mjs';
import { PLANNING_FOLDER } from '@openplanr/protocol/names';
import { currentDesign, hash, readJson } from './document-state.mjs';
import { workspaceReviewUrl } from './workspace-address.mjs';

export const FORMAT = 'openplanr-design-owner-custody';
export function custodyLocation(file, options = {}, { allowMissing = false } = {}) {
  const current = currentDesign(file, options);
  const env = options.env ?? process.env;
  const root = resolve(options.custodyRoot ?? join(planrHome(env), 'design-shares'));
  let project = current.root;
  for (
    let candidate = current.root;
    dirname(candidate) !== candidate;
    candidate = dirname(candidate)
  ) {
    if (existsSync(join(candidate, '.git')) || existsSync(join(candidate, PLANNING_FOLDER))) {
      project = candidate;
      break;
    }
  }
  const key = hash(`${current.root}\n${current.document.id}`);
  const path = join(root, `${key}.json`);
  const within = relative(project, root);
  if (
    (!allowMissing || existsSync(path)) &&
    (within === '' ||
      (!within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
        within !== '..' &&
        !isAbsolute(within)))
  )
    throw new Error(
      'Design owner keys must be stored outside the project. Set PLANR_HOME to a private user-level directory.',
    );
  const legacyPath =
    !options.custodyRoot && !configuredPlanrHome(env)
      ? join(realpathSync(env.HOME || homedir()), '.openplanr', 'design-shares', `${key}.json`)
      : null;
  return { root, path, current, legacyPath };
}
export function presentationFingerprint(current) {
  const state = readJson(join(current.root, '.design/studio-state.json'), { state: {} }).state;
  return hash(
    JSON.stringify({
      revision: current.revision,
      selectedVariant: state.selectedVariant ?? current.document.selectedVariant,
      positions: state.positions ?? {},
      verification: current.verification.status,
    }),
  );
}
export const safeStatus = (record, current) => ({
  ok: true,
  shared: Boolean(record),
  title: current.document.title,
  localRevision: current.revision,
  retention: 'until-revoked',
  ...(record
    ? {
        id: record.custody.id,
        url: workspaceReviewUrl(record.custody),
        revision: record.custody.currentRevision ?? record.publishedRevision ?? null,
        publishedRevision: record.publishedRevision ?? null,
        hasUpdate:
          record.publishedRevision !== current.revision ||
          record.publishedPresentation !== presentationFingerprint(current),
        epoch: record.custody.epoch,
        commentsPaused: Boolean(record.custody.commentsPaused ?? record.commentsPaused),
        revoked: Boolean(record.revoked),
        deleted: Boolean(record.deleted),
        pending: Boolean(
          record.custody.pendingCreate ||
            record.custody.pendingMutation ||
            record.pendingReviewMetadata?.length,
        ),
        pendingAction: record.custody.pendingCreate
          ? 'create'
          : (record.custody.pendingMutation?.action ??
            (record.pendingReviewMetadata?.length ? 'review-metadata' : null)),
        pendingReviewMetadata: Boolean(record.pendingReviewMetadata?.length),
      }
    : {}),
});

export function getDesignShareStatus(file, options = {}) {
  const { path, current, legacyPath } = custodyLocation(file, options);
  const record =
    readCustody(path, { label: 'Design', format: FORMAT }) ??
    (legacyPath ? readCustody(legacyPath, { label: 'Design', format: FORMAT }) : null);
  return safeStatus(record, current);
}
