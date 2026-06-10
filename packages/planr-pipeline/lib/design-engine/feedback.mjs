/**
 * The board↔agent FILE handshake (hard rule 3). The board writes feedback as a
 * file NEXT TO the board HTML; the agent reads it only after the user says
 * they're done in the blocking AskUserQuestion — never parsed from chat.
 *
 *   feedback.json          — final submit / approve round. Left in place.
 *   feedback-pending.json  — regenerate / remix / more-like round. CONSUMED
 *                            (deleted) on read so a stale pending round can
 *                            never be double-applied.
 *
 * Every read validates against design-feedback.schema.json + the cross-field
 * rule the schema can't express (regenerated=true ⇒ regenerateAction present).
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FEEDBACK_SCHEMA = JSON.parse(
  readFileSync(join(here, '../../schemas/v1.0.0/design-feedback.schema.json'), 'utf-8'),
);

export const FEEDBACK_FILE = 'feedback.json';
export const PENDING_FILE = 'feedback-pending.json';

/** Clamp + round a pin into the normalized 0..1 space (the schema has no `maximum`). */
export function clampPin(pin) {
  const unit = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 10000) / 10000;
  return { ...pin, x: unit(pin.x), y: unit(pin.y), w: unit(pin.w), h: unit(pin.h) };
}

export function assertValidFeedback(feedback) {
  const errs = validate(feedback, FEEDBACK_SCHEMA);
  if (errs.length > 0) {
    throw new Error(`invalid design-feedback: ${errs.map((e) => `${e.path} ${e.rule}`).join('; ')}`);
  }
  if (feedback.regenerated && !feedback.regenerateAction) {
    throw new Error('invalid design-feedback: regenerated=true requires regenerateAction');
  }
  return feedback;
}

/**
 * Read whichever feedback file the board produced.
 * @returns {{ kind: 'submit'|'pending', feedback: object }|null} null when neither file exists.
 */
export function readFeedback(boardDir) {
  const pendingPath = join(boardDir, PENDING_FILE);
  if (existsSync(pendingPath)) {
    const feedback = assertValidFeedback(JSON.parse(readFileSync(pendingPath, 'utf-8')));
    unlinkSync(pendingPath); // consumed on read — never double-applied
    return { kind: 'pending', feedback };
  }
  const submitPath = join(boardDir, FEEDBACK_FILE);
  if (existsSync(submitPath)) {
    const feedback = assertValidFeedback(JSON.parse(readFileSync(submitPath, 'utf-8')));
    return { kind: 'submit', feedback };
  }
  return null;
}
