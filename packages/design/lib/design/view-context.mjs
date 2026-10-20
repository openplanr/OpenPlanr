import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DOCUMENT_SCHEMA } from '@openplanr/protocol/design-contracts';
import { currentDesign } from './document-state.mjs';

const anchorPattern = new RegExp(DESIGN_DOCUMENT_SCHEMA.$defs.id.pattern, 'u');
const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const boardFields = ['screenId', 'frameId', 'variantId'];

export function validateDesignViewContext(input, current) {
  if (!exact(input, ['revision', 'view', 'visibleScreens', 'selected', 'dirty']))
    throw new Error(
      'View context requires exactly revision, view, visibleScreens, selected and dirty.',
    );
  if (input.revision !== current.revision)
    throw Object.assign(
      new Error(
        `View context revision ${input.revision} is stale; current revision is ${current.revision}.`,
      ),
      { statusCode: 409 },
    );
  if (!['canvas', 'prototype', 'walkthrough'].includes(input.view))
    throw new Error(`Unknown view context view ${input.view}.`);
  if (typeof input.dirty !== 'boolean')
    throw new Error(`View context dirty must be boolean; received ${input.dirty}.`);
  const board = (value, selected = false) => {
    if (!exact(value, selected ? [...boardFields, 'planrId'] : boardFields))
      throw new Error(
        `View context ${selected ? 'selected' : 'visibleScreens entry'} has invalid fields.`,
      );
    if (!current.entries.some((entry) => boardFields.every((key) => entry[key] === value[key])))
      throw new Error(`Unknown view context board ${JSON.stringify(value)}.`);
    return boardFields.map((key) => value[key]).join('/');
  };
  if (!Array.isArray(input.visibleScreens) || input.visibleScreens.length > current.entries.length)
    throw new Error(
      `View context visibleScreens must contain at most ${current.entries.length} boards.`,
    );
  const keys = input.visibleScreens.map((value) => board(value));
  if (new Set(keys).size !== keys.length)
    throw new Error('View context visibleScreens contains duplicate boards.');
  board(input.selected, true);
  const { planrId } = input.selected;
  if (
    planrId !== null &&
    (typeof planrId !== 'string' || planrId.length > 128 || !anchorPattern.test(planrId))
  )
    throw new Error(
      `View context planrId ${JSON.stringify(planrId)} must be null or a document anchor ID of at most 128 characters.`,
    );
  return structuredClone(input);
}

/** Reads validated viewer data, or explains why it cannot scope a request. */
export function readDesignViewContext(file, { requestTime } = {}) {
  try {
    const current = currentDesign(file);
    const path = join(current.root, '.design/view-context.json');
    const bytes = readFileSync(path);
    if (bytes.length > 128 * 1024) throw new Error(`${path} exceeds 128 KB.`);
    const value = JSON.parse(bytes.toString('utf8'));
    if (
      !exact(value, [
        'kind',
        'schemaVersion',
        'revision',
        'updatedAt',
        'view',
        'visibleScreens',
        'selected',
        'dirty',
      ]) ||
      value.kind !== 'openplanr-design-view-context' ||
      value.schemaVersion !== '1.0.0'
    )
      throw new Error(`${path} is not a supported design view context.`);
    if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
      throw new Error(`${path} has an invalid updatedAt timestamp.`);
    const { kind, schemaVersion, updatedAt, ...input } = value;
    validateDesignViewContext(input, current);
    if (requestTime !== undefined) {
      const requestedAt = Date.parse(requestTime);
      if (!Number.isFinite(requestedAt))
        throw new Error(`Invalid view context request time ${requestTime}.`);
      if (Date.parse(updatedAt) < requestedAt)
        throw new Error(
          `View context updatedAt ${updatedAt} is older than request ${requestTime}.`,
        );
    }
    return value;
  } catch (error) {
    return { viewContext: null, reason: error.message };
  }
}
