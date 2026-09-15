/**
 * Session persistence — one variant's generation lineage (design-session schema).
 * Sessions live IN the session dir (user space), never /tmp, so an exploration
 * can be revisited days later. Every write is schema-validated.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { assertValid } from '../design/schema-loader.mjs';

export function sessionFilePath(sessionDir, variant) {
  return join(sessionDir, `session-${variant}.json`);
}

/** Throws with the violation list when a session object is off-schema. */
export function assertValidSession(session) {
  return assertValid(session, 'design-session');
}

/**
 * @param {{ id: string, provider: 'openai'|'claude-svg', target: string, project?: string,
 *           brief: string, now?: () => Date }} input
 */
export function createSession({ id, provider, target, project = '', brief, now = () => new Date() }) {
  const ts = now().toISOString();
  return assertValidSession({
    schema_version: '1.0.0',
    id,
    provider,
    target,
    project,
    originalBrief: brief,
    briefVersions: [brief],
    feedbackHistory: [],
    outputPaths: [],
    regionEdits: [],
    lastResponseId: null,
    createdAt: ts,
    updatedAt: ts,
  });
}

export function saveSession(sessionDir, variant, session) {
  assertValidSession(session);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(sessionFilePath(sessionDir, variant), `${JSON.stringify(session, null, 2)}\n`);
  return session;
}

export function loadSession(sessionDir, variant) {
  const p = sessionFilePath(sessionDir, variant);
  if (!existsSync(p)) return null;
  return assertValidSession(JSON.parse(readFileSync(p, 'utf-8')));
}

export function cloneSession(session) {
  const { outputPaths, feedbackHistory, briefVersions, regionEdits, ...shallow } = session;
  return {
    ...shallow,
    outputPaths: [...outputPaths],
    feedbackHistory: [...feedbackHistory],
    briefVersions: [...briefVersions],
    regionEdits: regionEdits.map((r) => ({ ...r, pins: [...r.pins] })),
  };
}

/** Append a generation round: the artifact it produced (+ optional chain id / feedback). */
export function appendRound(session, { outputPath, responseId, feedback, brief, now = () => new Date() }) {
  const next = cloneSession(session);
  next.outputPaths = [...session.outputPaths, outputPath];
  if (responseId !== undefined) next.lastResponseId = responseId;
  if (feedback) next.feedbackHistory = [...session.feedbackHistory, feedback];
  if (brief && brief !== session.briefVersions[session.briefVersions.length - 1]) {
    next.briefVersions = [...session.briefVersions, brief];
  }
  next.updatedAt = now().toISOString();
  return assertValidSession(next);
}

/** Record a pin-driven region edit (design-review rounds). */
export function recordRegionEdit(session, { screen, pins, summary, now = () => new Date() }) {
  const next = cloneSession(session);
  const edit = { at: now().toISOString(), pins, summary };
  if (screen) edit.screen = screen;
  next.regionEdits.push(edit);
  next.updatedAt = edit.at;
  return assertValidSession(next);
}
