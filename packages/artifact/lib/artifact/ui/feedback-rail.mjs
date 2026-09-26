/**
 * Pure Protocol v1.1 artifact-review state and the browser feedback-rail
 * adapter. This module deliberately owns no persistence: callers consume the
 * immutable `planr:artifact-review-change` events and decide when to export or
 * share them.
 */

import { annotationDomIds } from './annotations.mjs';

export const ARTIFACT_REVIEW_CHANGE_EVENT = 'planr:artifact-review-change';
export const ARTIFACT_REVIEW_SELECT_EVENT = 'planr:artifact-review-select';
export const ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT = 'planr:artifact-review-draft-change';

export const ARTIFACT_REVIEW_LIMITS = Object.freeze({
  id: 128,
  authorName: 256,
  artifactId: 128,
  variant: 128,
  anchor: 512,
  screen: 128,
  text: 65_536,
  pins: 10_000,
  replies: 10_000,
  viewport: 16_384,
});

export const ARTIFACT_REVIEW_DECISIONS = Object.freeze([
  'pending',
  'approved',
  'changes_requested',
]);
export const ARTIFACT_REVIEW_INTENTS = Object.freeze(['fix', 'improve', 'question']);
export const ARTIFACT_REVIEW_STATUSES = Object.freeze(['open', 'addressed', 'resolved']);

const REVIEW_OF_RE = /^[a-f0-9]{64}$/;

export class ArtifactReviewStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArtifactReviewStateError';
    this.code = code;
  }
}

function invalid(message) {
  throw new ArtifactReviewStateError('E_ARTIFACT_REVIEW_INVALID', message);
}

function identityRequired() {
  throw new ArtifactReviewStateError(
    'E_ARTIFACT_REVIEW_IDENTITY_REQUIRED',
    'Enter your name before adding a comment.',
  );
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== 'object') return value;
  const clone = {};
  for (const [key, entry] of Object.entries(value)) clone[key] = clonePlain(entry);
  return clone;
}

export function deepFreezeArtifactReview(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreezeArtifactReview(entry);
  return Object.freeze(value);
}

export function cloneFrozenArtifactReview(review) {
  return deepFreezeArtifactReview(clonePlain(review));
}

function boundedString(value, label, { min = 0, max, trim = false, pattern } = {}) {
  if (typeof value !== 'string') invalid(`${label} must be a string.`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || (max !== undefined && normalized.length > max)) {
    invalid(`${label} must contain ${min} through ${max ?? 'unlimited'} characters.`);
  }
  if (pattern && !pattern.test(normalized)) invalid(`${label} has an invalid format.`);
  return normalized;
}

function optionalString(value, label, options) {
  if (value === undefined) return undefined;
  return boundedString(value, label, options);
}

function enumValue(value, values, label) {
  if (!values.includes(value)) invalid(`${label} must be one of: ${values.join(', ')}.`);
  return value;
}

function isoTimestamp(value, label) {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    invalid(`${label} must be an ISO-8601 date-time.`);
  }
  return timestamp;
}

function dependencyTimestamp(now) {
  return isoTimestamp(now(), 'now()');
}

function defaultNow() {
  return new Date().toISOString();
}

export function createSecureArtifactReviewId(cryptoProvider = globalThis.crypto) {
  const randomUuid = cryptoProvider?.randomUUID?.();
  if (randomUuid) return randomUuid;
  const bytes = new Uint8Array(16);
  if (typeof cryptoProvider?.getRandomValues !== 'function') {
    throw new ArtifactReviewStateError(
      'E_ARTIFACT_REVIEW_UUID_UNAVAILABLE',
      'Secure UUID generation is unavailable in this browser.',
    );
  }
  cryptoProvider.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultCreateId() {
  return createSecureArtifactReviewId();
}

function dependencyId(createId, kind) {
  return boundedString(createId(kind), `${kind} id`, {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.id,
    trim: true,
  });
}

function uniqueDependencyId(createId, kind, existingIds) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = dependencyId(createId, kind);
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new ArtifactReviewStateError(
    'E_ARTIFACT_REVIEW_ID_COLLISION',
    `Could not create a unique ${kind} id.`,
  );
}

export function normalizeArtifactReviewIdentity(value, { allowEmpty = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowEmpty) return null;
    identityRequired();
  }
  const source = typeof value === 'string' ? { name: value } : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) identityRequired();
  const name = boundedString(source.name, 'author.name', {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.authorName,
    trim: true,
  });
  const id = optionalString(source.id, 'author.id', {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.id,
    trim: true,
  });
  return deepFreezeArtifactReview(id === undefined ? { name } : { id, name });
}

function normalizeRegion(region) {
  if (!region || typeof region !== 'object' || Array.isArray(region)) {
    invalid('pin.region must be an object.');
  }
  const unit = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be finite.`);
    return Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000;
  };
  const x = unit(region.x, 'pin.region.x');
  const y = unit(region.y, 'pin.region.y');
  const w = Math.round(Math.min(unit(region.w, 'pin.region.w'), 1 - x) * 1_000_000) / 1_000_000;
  const h = Math.round(Math.min(unit(region.h, 'pin.region.h'), 1 - y) * 1_000_000) / 1_000_000;
  return { x, y, w, h };
}

function normalizeViewport(viewport) {
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) {
    invalid('pin.viewport must be an object.');
  }
  const dimension = (value, label) => {
    if (!Number.isInteger(value) || value < 1 || value > ARTIFACT_REVIEW_LIMITS.viewport) {
      invalid(`${label} must be an integer from 1 through ${ARTIFACT_REVIEW_LIMITS.viewport}.`);
    }
    return value;
  };
  return {
    width: dimension(viewport.width, 'pin.viewport.width'),
    height: dimension(viewport.height, 'pin.viewport.height'),
  };
}

function normalizeAnchor(anchor) {
  if (anchor === undefined || anchor === null) return undefined;
  if (typeof anchor !== 'object' || Array.isArray(anchor)) invalid('pin.anchor must be an object.');
  const planrId = boundedString(anchor.planrId, 'pin.anchor.planrId', {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.anchor,
    trim: true,
  });
  const screen = optionalString(anchor.screen, 'pin.anchor.screen', {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.screen,
    trim: true,
  });
  return screen === undefined ? { planrId } : { planrId, screen };
}

function normalizeReply(reply, label = 'reply') {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply))
    invalid(`${label} must be an object.`);
  return {
    id: boundedString(reply.id, `${label}.id`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true,
    }),
    author: normalizeArtifactReviewIdentity(reply.author),
    comment: boundedString(reply.comment, `${label}.comment`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.text,
      trim: true,
    }),
    createdAt: isoTimestamp(reply.createdAt, `${label}.createdAt`),
  };
}

function compareTimestampThenId(left, right) {
  const byTime = left.createdAt.localeCompare(right.createdAt);
  return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
}

function normalizePin(pin, label = 'pin') {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) invalid(`${label} must be an object.`);
  if (!Array.isArray(pin.replies) || pin.replies.length > ARTIFACT_REVIEW_LIMITS.replies) {
    invalid(`${label}.replies must contain no more than ${ARTIFACT_REVIEW_LIMITS.replies} items.`);
  }
  const replies = pin.replies.map((reply, index) =>
    normalizeReply(reply, `${label}.replies[${index}]`),
  );
  const replyIds = new Set(replies.map(({ id }) => id));
  if (replyIds.size !== replies.length) invalid(`${label}.replies must have unique ids.`);

  const normalized = {
    id: boundedString(pin.id, `${label}.id`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true,
    }),
    author: normalizeArtifactReviewIdentity(pin.author),
    artifactId: boundedString(pin.artifactId, `${label}.artifactId`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.artifactId,
      trim: true,
    }),
    region: normalizeRegion(pin.region),
    viewport: normalizeViewport(pin.viewport),
    intent: enumValue(pin.intent, ARTIFACT_REVIEW_INTENTS, `${label}.intent`),
    status: enumValue(pin.status, ARTIFACT_REVIEW_STATUSES, `${label}.status`),
    comment: boundedString(pin.comment, `${label}.comment`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.text,
      trim: true,
    }),
    replies: replies.sort(compareTimestampThenId),
    createdAt: isoTimestamp(pin.createdAt, `${label}.createdAt`),
    updatedAt: isoTimestamp(pin.updatedAt, `${label}.updatedAt`),
  };
  const variant = optionalString(pin.variant, `${label}.variant`, {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.variant,
    trim: true,
  });
  const anchor = normalizeAnchor(pin.anchor);
  if (variant !== undefined) normalized.variant = variant;
  if (anchor !== undefined) normalized.anchor = anchor;
  return normalized;
}

export function normalizeArtifactReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    invalid('Artifact review must be an object.');
  }
  if (!Array.isArray(review.pins) || review.pins.length > ARTIFACT_REVIEW_LIMITS.pins) {
    invalid(`review.pins must contain no more than ${ARTIFACT_REVIEW_LIMITS.pins} items.`);
  }
  const pins = review.pins.map((pin, index) => normalizePin(pin, `review.pins[${index}]`));
  const pinIds = new Set(pins.map(({ id }) => id));
  if (pinIds.size !== pins.length) invalid('review.pins must have unique ids.');

  const normalized = {
    schemaVersion: enumValue(review.schemaVersion, ['1.0.0'], 'review.schemaVersion'),
    reviewId: boundedString(review.reviewId, 'review.reviewId', {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true,
    }),
    reviewOf: boundedString(review.reviewOf, 'review.reviewOf', {
      min: 64,
      max: 64,
      pattern: REVIEW_OF_RE,
    }),
    decision: enumValue(review.decision, ARTIFACT_REVIEW_DECISIONS, 'review.decision'),
    overall: boundedString(review.overall, 'review.overall', {
      max: ARTIFACT_REVIEW_LIMITS.text,
    }),
    pins: pins.sort(compareTimestampThenId),
  };
  if (review.createdAt !== undefined)
    normalized.createdAt = isoTimestamp(review.createdAt, 'review.createdAt');
  if (review.updatedAt !== undefined)
    normalized.updatedAt = isoTimestamp(review.updatedAt, 'review.updatedAt');
  return deepFreezeArtifactReview(normalized);
}

export function createArtifactReview({ reviewId, reviewOf, createId = defaultCreateId } = {}) {
  const normalizedReviewId =
    reviewId === undefined
      ? dependencyId(createId, 'review')
      : boundedString(reviewId, 'reviewId', {
          min: 1,
          max: ARTIFACT_REVIEW_LIMITS.id,
          trim: true,
        });
  return normalizeArtifactReview({
    schemaVersion: '1.0.0',
    reviewId: normalizedReviewId,
    reviewOf: boundedString(reviewOf, 'reviewOf', {
      min: 64,
      max: 64,
      pattern: REVIEW_OF_RE,
    }),
    decision: 'pending',
    overall: '',
    pins: [],
  });
}

function replacePin(review, pin) {
  return review.pins.map((candidate) => (candidate.id === pin.id ? pin : candidate));
}

function findPin(review, pinId) {
  const normalizedId = boundedString(pinId, 'pinId', {
    min: 1,
    max: ARTIFACT_REVIEW_LIMITS.id,
    trim: true,
  });
  const pin = review.pins.find(({ id }) => id === normalizedId);
  if (!pin) {
    throw new ArtifactReviewStateError(
      'E_ARTIFACT_REVIEW_PIN_NOT_FOUND',
      `Unknown feedback pin: ${normalizedId}`,
    );
  }
  return pin;
}

function preserveOptionalReviewTimestamps(review, next, timestamp) {
  if (review.createdAt !== undefined) next.createdAt = review.createdAt;
  if (review.updatedAt !== undefined) next.updatedAt = timestamp;
  return next;
}

/**
 * Pure reducer for the Protocol review object. `author` is supplied explicitly
 * here; createArtifactReviewController injects the current local identity for
 * authored actions so identity never becomes a top-level protocol field.
 */
export function reduceArtifactReview(
  review,
  action,
  { createId = defaultCreateId, now = defaultNow } = {},
) {
  const current = normalizeArtifactReview(review);
  if (!action || typeof action !== 'object' || Array.isArray(action))
    invalid('Review action must be an object.');
  const timestamp = dependencyTimestamp(now);
  let next;

  switch (action.type) {
    case 'add-pin': {
      if (current.pins.length >= ARTIFACT_REVIEW_LIMITS.pins) {
        invalid(`A review can contain at most ${ARTIFACT_REVIEW_LIMITS.pins} pins.`);
      }
      const author = normalizeArtifactReviewIdentity(action.author);
      const pinInput = action.pin && typeof action.pin === 'object' ? action.pin : {};
      const pinId =
        pinInput.id === undefined
          ? uniqueDependencyId(createId, 'pin', new Set(current.pins.map(({ id }) => id)))
          : boundedString(pinInput.id, 'pin.id', {
              min: 1,
              max: ARTIFACT_REVIEW_LIMITS.id,
              trim: true,
            });
      if (current.pins.some(({ id }) => id === pinId)) {
        throw new ArtifactReviewStateError(
          'E_ARTIFACT_REVIEW_ID_COLLISION',
          `Duplicate pin id: ${pinId}`,
        );
      }
      const pin = normalizePin({
        ...pinInput,
        id: pinId,
        author,
        status: pinInput.status ?? 'open',
        replies: [],
        createdAt: pinInput.createdAt ?? timestamp,
        updatedAt: pinInput.updatedAt ?? timestamp,
      });
      next = preserveOptionalReviewTimestamps(
        current,
        {
          ...current,
          pins: [...current.pins, pin],
        },
        timestamp,
      );
      break;
    }
    case 'add-reply': {
      const pin = findPin(current, action.pinId);
      if (pin.replies.length >= ARTIFACT_REVIEW_LIMITS.replies) {
        invalid(`A feedback thread can contain at most ${ARTIFACT_REVIEW_LIMITS.replies} replies.`);
      }
      const replyId =
        action.id === undefined
          ? uniqueDependencyId(createId, 'reply', new Set(pin.replies.map(({ id }) => id)))
          : boundedString(action.id, 'reply.id', {
              min: 1,
              max: ARTIFACT_REVIEW_LIMITS.id,
              trim: true,
            });
      if (pin.replies.some(({ id }) => id === replyId)) {
        throw new ArtifactReviewStateError(
          'E_ARTIFACT_REVIEW_ID_COLLISION',
          `Duplicate reply id: ${replyId}`,
        );
      }
      const reply = normalizeReply({
        id: replyId,
        author: normalizeArtifactReviewIdentity(action.author),
        comment: action.comment,
        createdAt: action.createdAt ?? timestamp,
      });
      const updatedPin = normalizePin({
        ...pin,
        replies: [...pin.replies, reply],
        updatedAt: timestamp,
      });
      next = preserveOptionalReviewTimestamps(
        current,
        {
          ...current,
          pins: replacePin(current, updatedPin),
        },
        timestamp,
      );
      break;
    }
    case 'set-status': {
      const pin = findPin(current, action.pinId);
      const updatedPin = normalizePin({
        ...pin,
        status: enumValue(action.status, ARTIFACT_REVIEW_STATUSES, 'status'),
        updatedAt: timestamp,
      });
      next = preserveOptionalReviewTimestamps(
        current,
        {
          ...current,
          pins: replacePin(current, updatedPin),
        },
        timestamp,
      );
      break;
    }
    case 'set-overall':
      next = preserveOptionalReviewTimestamps(
        current,
        {
          ...current,
          overall: boundedString(action.overall, 'overall', { max: ARTIFACT_REVIEW_LIMITS.text }),
        },
        timestamp,
      );
      break;
    case 'set-decision':
      next = preserveOptionalReviewTimestamps(
        current,
        {
          ...current,
          decision: enumValue(action.decision, ARTIFACT_REVIEW_DECISIONS, 'decision'),
        },
        timestamp,
      );
      break;
    default:
      throw new ArtifactReviewStateError(
        'E_ARTIFACT_REVIEW_ACTION_UNKNOWN',
        `Unknown artifact review action: ${String(action.type)}`,
      );
  }

  return normalizeArtifactReview(next);
}

export function createArtifactReviewController({
  initialReview = null,
  reviewOf,
  reviewId,
  identity = null,
  createId = defaultCreateId,
  now = defaultNow,
} = {}) {
  let review =
    initialReview === null || initialReview === undefined
      ? null
      : normalizeArtifactReview(initialReview);
  if (review && reviewOf !== undefined && review.reviewOf !== reviewOf) {
    throw new ArtifactReviewStateError(
      'E_ARTIFACT_REVIEW_DIGEST_MISMATCH',
      'The initial review does not match the artifact envelope digest.',
    );
  }
  let localIdentity = normalizeArtifactReviewIdentity(identity, { allowEmpty: true });
  let activePinId = null;
  let destroyed = false;
  const listeners = new Set();

  const assertAlive = () => {
    if (destroyed) {
      throw new ArtifactReviewStateError(
        'E_ARTIFACT_REVIEW_DESTROYED',
        'Artifact review controller is destroyed.',
      );
    }
  };

  const ensureReview = () => {
    review ??= createArtifactReview({ reviewId, reviewOf, createId });
    return review;
  };

  const getState = () =>
    deepFreezeArtifactReview({
      review,
      identity: localIdentity,
      activePinId,
    });

  const notify = (change) => {
    const state = getState();
    for (const listener of [...listeners]) listener(state, deepFreezeArtifactReview({ ...change }));
  };

  const controller = {
    getReview() {
      return review;
    },
    getState,
    getIdentity() {
      return localIdentity;
    },
    setIdentity(value) {
      assertAlive();
      localIdentity = normalizeArtifactReviewIdentity(value, { allowEmpty: true });
      notify({ type: 'identity' });
      return localIdentity;
    },
    dispatch(action) {
      assertAlive();
      const authored = action?.type === 'add-pin' || action?.type === 'add-reply';
      const nextAction =
        authored && action.author === undefined
          ? { ...action, author: localIdentity ?? identityRequired() }
          : action;
      const previousPinIds =
        nextAction?.type === 'add-pin' ? new Set(review?.pins.map(({ id }) => id) ?? []) : null;
      review = reduceArtifactReview(ensureReview(), nextAction, { createId, now });
      if (previousPinIds) {
        activePinId = review.pins.find(({ id }) => !previousPinIds.has(id))?.id ?? activePinId;
      }
      notify({ type: 'review', action: nextAction.type });
      return review;
    },
    replaceReview(value) {
      assertAlive();
      const next = value === null || value === undefined ? null : normalizeArtifactReview(value);
      if (next && reviewOf !== undefined && next.reviewOf !== reviewOf) {
        throw new ArtifactReviewStateError(
          'E_ARTIFACT_REVIEW_DIGEST_MISMATCH',
          'The replacement review does not match the artifact envelope digest.',
        );
      }
      review = next;
      if (activePinId && !review?.pins.some(({ id }) => id === activePinId)) activePinId = null;
      notify({ type: 'review-replaced' });
      return review;
    },
    selectPin(pinId) {
      assertAlive();
      if (pinId === null || pinId === undefined) {
        activePinId = null;
      } else {
        activePinId = findPin(ensureReview(), pinId).id;
      }
      notify({ type: 'selection' });
      return activePinId;
    },
    subscribe(listener) {
      assertAlive();
      if (typeof listener !== 'function') invalid('Review subscriber must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      review = null;
      localIdentity = null;
      activePinId = null;
    },
  };

  return Object.freeze(controller);
}

function createElement(document, tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  return element;
}

export function artifactReviewThreadDomId(pinId) {
  return annotationDomIds(pinId).thread;
}

function displayTimestamp(timestamp) {
  const canonical = new Date(timestamp).toISOString();
  return `${canonical.slice(0, 10)} ${canonical.slice(11, 16)} UTC`;
}

function renderReply(document, reply) {
  const item = createElement(document, 'li', {
    className: 'planr-reply',
    attributes: { 'data-planr-reply-id': reply.id },
  });
  const heading = createElement(document, 'header');
  heading.append(createElement(document, 'strong', { text: reply.author.name }));
  const time = createElement(document, 'time', {
    text: displayTimestamp(reply.createdAt),
    attributes: { datetime: reply.createdAt },
  });
  heading.append(time);
  item.append(heading, createElement(document, 'p', { text: reply.comment }));
  return item;
}

function renderReplyForm(document, pin, expanded = false) {
  const fieldId = `${annotationDomIds(pin.id).thread}-reply`;
  const wrapper = createElement(document, 'div', { className: 'planr-reply-editor' });
  const toggle = createElement(document, 'button', {
    className: 'planr-reply-toggle',
    text: expanded ? '− Reply' : '+ Reply',
    attributes: {
      type: 'button',
      id: `${fieldId}-toggle`,
      'data-planr-reply-toggle': pin.id,
      'aria-expanded': String(expanded),
      'aria-controls': `${fieldId}-form`,
      title: expanded ? 'Collapse reply' : 'Reply to this comment',
    },
  });
  const form = createElement(document, 'form', {
    className: 'planr-reply-form',
    attributes: {
      'data-planr-reply-form': pin.id,
      id: `${fieldId}-form`,
      ...(expanded ? {} : { hidden: '' }),
    },
  });
  const label = createElement(document, 'label', {
    className: 'planr-reply-label',
    text: 'Reply to thread',
    attributes: { for: fieldId },
  });
  const textarea = createElement(document, 'textarea', {
    attributes: {
      id: fieldId,
      name: 'reply',
      maxlength: ARTIFACT_REVIEW_LIMITS.text,
      rows: 2,
      placeholder: 'Write a reply…',
      required: '',
      'aria-describedby': 'planr-review-error',
    },
  });
  const controls = createElement(document, 'div', { className: 'planr-reply-controls' });
  const hint = createElement(document, 'span', {
    className: 'planr-reply-hint',
    text: 'Ctrl/⌘ + Enter to send',
  });
  const submit = createElement(document, 'button', {
    className: 'planr-reply-send',
    attributes: {
      type: 'submit',
      disabled: '',
      'aria-label': 'Send reply',
      title: 'Send reply (Ctrl/⌘ + Enter)',
    },
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '16',
    height: '16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }))
    svg.setAttribute(name, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 19V5m-6 6 6-6 6 6');
  svg.append(path);
  submit.append(svg);
  controls.append(hint, submit);
  form.append(label, textarea, controls);
  wrapper.append(toggle, form);
  return wrapper;
}

function renderThread(document, pin, active, description = {}) {
  const intentLabel =
    typeof description.intentLabel === 'string'
      ? description.intentLabel.slice(0, 128)
      : pin.intent;
  const article = createElement(document, 'article', {
    className: `planr-thread${active ? ' is-active' : ''}`,
    attributes: {
      id: artifactReviewThreadDomId(pin.id),
      tabindex: '-1',
      'data-planr-pin-id': pin.id,
      'data-planr-intent': pin.intent,
      'data-planr-status': pin.status,
      'aria-controls': annotationDomIds(pin.id).pin,
      'aria-label': `${intentLabel} comment by ${pin.author.name}`,
      'data-planr-unread': description.unread === true ? 'true' : 'false',
      ...(description.compact ? { 'data-planr-compact': 'true' } : {}),
    },
  });
  const header = createElement(document, 'header');
  const byline = createElement(document, 'div', { className: 'planr-review-byline' });
  byline.append(
    createElement(document, 'strong', { text: pin.author.name }),
    createElement(document, 'span', { className: 'planr-intent', text: intentLabel }),
  );
  const time = createElement(document, 'time', {
    text: description.compact
      ? `${new Date(pin.createdAt).toISOString().slice(11, 16)} UTC`
      : displayTimestamp(pin.createdAt),
    attributes: { datetime: pin.createdAt, title: displayTimestamp(pin.createdAt) },
  });
  header.append(byline, time);

  const comment = createElement(document, 'p', {
    className: 'planr-thread-comment',
    text: pin.comment,
  });
  const lifecycle = createElement(document, 'div', { className: 'planr-thread-actions' });
  lifecycle.append(
    createElement(document, 'span', {
      className: 'planr-thread-status',
      text: pin.status,
      attributes: { title: `Status: ${pin.status}` },
    }),
    createElement(document, 'button', {
      text: pin.status === 'resolved' ? 'Reopen' : 'Resolve',
      attributes: {
        type: 'button',
        'data-planr-thread-action': pin.status === 'resolved' ? 'reopen' : 'resolve',
        'data-planr-pin-id': pin.id,
      },
    }),
    createElement(document, 'button', {
      text: 'Show pin',
      attributes: {
        type: 'button',
        'data-planr-thread-focus': pin.id,
        'aria-controls': annotationDomIds(pin.id).pin,
      },
    }),
  );
  const replies = createElement(document, 'ol', {
    className: 'planr-replies',
    attributes: { 'aria-label': 'Replies' },
  });
  const earlierReplies = description.compact
    ? Math.max(0, pin.replies.length - (description.replyLimit || 2))
    : 0;
  for (const reply of pin.replies.slice(earlierReplies))
    replies.append(renderReply(document, reply));
  const editor = renderReplyForm(document, pin, description.replyExpanded);
  article.append(header, comment);
  if (description.compact && pin.comment.length > 240) {
    comment.dataset.planrCommentCollapsed = String(!description.commentExpanded);
    article.append(
      createElement(document, 'button', {
        className: 'planr-comment-expand',
        text: description.commentExpanded ? 'Show less' : 'Read full comment',
        attributes: {
          type: 'button',
          id: `${annotationDomIds(pin.id).thread}-expand`,
          'data-planr-comment-expand': pin.id,
          'aria-expanded': String(Boolean(description.commentExpanded)),
        },
      }),
    );
  }
  if (earlierReplies)
    article.append(
      createElement(document, 'button', {
        className: 'planr-history-expand',
        text: `Show ${earlierReplies} earlier ${earlierReplies === 1 ? 'reply' : 'replies'}`,
        attributes: {
          type: 'button',
          id: `${annotationDomIds(pin.id).thread}-history`,
          'data-planr-history-expand': pin.id,
          'aria-expanded': 'false',
        },
      }),
    );
  if (pin.replies.length) article.append(replies);
  if (description.compact) {
    lifecycle.append(editor.querySelector('[data-planr-reply-toggle]'));
    article.append(lifecycle, editor);
  } else article.append(lifecycle, editor);
  return article;
}

function decisionCopy(decision) {
  if (decision === 'approved') return 'Review approved';
  if (decision === 'changes_requested') return 'Changes requested';
  return 'Decision pending';
}

/**
 * Mount the rail into renderer-owned slots. All reviewer strings enter the DOM
 * through `textContent` (form controls use their `value` property); HTML
 * parsing is never used.
 */
export function mountArtifactFeedbackRail({
  root,
  document = root?.ownerDocument,
  window = document?.defaultView,
  controller: providedController,
  initialReview = null,
  reviewOf,
  reviewId,
  identity = null,
  createId = defaultCreateId,
  now = defaultNow,
  onSelectPin,
  presentation: initialPresentation = {},
} = {}) {
  if (!root || !document || !window) invalid('A browser root, document, and window are required.');
  const slot = root.querySelector('[data-planr-slot="feedback-rail"]');
  const identityInput = root.querySelector('[data-planr-reviewer-name]');
  const identityStatus = root.querySelector('[data-planr-identity-status]');
  const overall = root.querySelector('#planr-overall-note');
  const decisionStatus = root.querySelector('[data-planr-slot="decision-status"]');
  const decisionButtons = [...root.querySelectorAll('[data-planr-decision]')];
  if (!slot || !identityInput || !overall || !decisionStatus || decisionButtons.length === 0) {
    invalid('Artifact feedback renderer slots are missing.');
  }

  const ownsController = !providedController;
  const controller =
    providedController ??
    createArtifactReviewController({
      initialReview,
      reviewOf,
      reviewId,
      identity,
      createId,
      now,
    });
  let destroyed = false;
  let presentation = { ...initialPresentation };
  const replyDrafts = new Map();
  const expandedReplies = new Set();
  const expandedHistory = new Map(),
    expandedComments = new Set();
  let visibleLimit = Number.isInteger(initialPresentation.pageSize)
    ? initialPresentation.pageSize
    : Infinity;
  const extraDrafts = new Map();
  let overallDirty = false;
  let composing = false;
  let renderQueued = false;
  const captureDrafts = () => {
    for (const form of slot.querySelectorAll('[data-planr-reply-form]')) {
      const field = form.elements.namedItem('reply');
      if (field) replyDrafts.set(form.dataset.planrReplyForm, field.value);
    }
    for (const field of slot.querySelectorAll('[data-planr-draft-key]')) {
      if (typeof field.value === 'string')
        extraDrafts.set(field.dataset.planrDraftKey, field.value);
    }
  };
  const snapshotDrafts = () => {
    captureDrafts();
    return cloneFrozenArtifactReview({
      reviewOf: controller.getReview()?.reviewOf ?? reviewOf,
      replies: Object.fromEntries(replyDrafts),
      expandedReplies: [...expandedReplies],
      fields: Object.fromEntries(extraDrafts),
      overall: { value: overall.value, dirty: overallDirty },
      identity: identityInput.value,
    });
  };
  const emitDraftChange = () =>
    root.dispatchEvent(
      new window.CustomEvent(ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT, {
        bubbles: true,
        detail: snapshotDrafts(),
      }),
    );
  const focusDescriptor = () => {
    const element = document.activeElement;
    if (!element || !slot.contains(element)) return null;
    const thread = element.closest('[data-planr-pin-id]');
    return {
      id: element.id,
      pinId: thread?.dataset.planrPinId,
      draftKey: element.dataset.planrDraftKey,
      action: element.dataset.planrThreadAction,
      showPin: element.dataset.planrThreadFocus,
      tag: element.tagName,
      name: element.name,
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection,
    };
  };
  const restoreFocus = (descriptor) => {
    if (!descriptor) return;
    const thread =
      descriptor.pinId && document.getElementById(artifactReviewThreadDomId(descriptor.pinId));
    const target =
      (descriptor.id && document.getElementById(descriptor.id)) ||
      (descriptor.draftKey &&
        [...slot.querySelectorAll('[data-planr-draft-key]')].find(
          (field) => field.dataset.planrDraftKey === descriptor.draftKey,
        )) ||
      (descriptor.action &&
        [...(thread?.querySelectorAll('[data-planr-thread-action]') ?? [])].find(
          (button) => button.dataset.planrThreadAction === descriptor.action,
        )) ||
      (descriptor.showPin && thread?.querySelector('[data-planr-thread-focus]')) ||
      [...(thread?.querySelectorAll('button,input,select,textarea') ?? [])].find(
        (field) => field.tagName === descriptor.tag && field.name === descriptor.name,
      );
    target?.focus?.({ preventScroll: true });
    if (Number.isInteger(descriptor.start))
      target?.setSelectionRange?.(descriptor.start, descriptor.end, descriptor.direction);
  };

  const showError = (error) => {
    const target = root.querySelector('#planr-review-error');
    if (!target) return;
    target.textContent = error?.message ?? String(error);
    target.hidden = false;
  };

  const clearError = () => {
    const target = root.querySelector('#planr-review-error');
    if (!target) return;
    target.textContent = '';
    target.hidden = true;
  };

  const announce = (message) => {
    decisionStatus.textContent = message;
    const live =
      root.parentElement?.querySelector('[data-planr-slot="review-announcer"]') ??
      document.querySelector('[data-planr-slot="review-announcer"]');
    if (live) live.textContent = message;
  };

  const updateCounts = (pins) => {
    const label = `${pins.length} ${pins.length === 1 ? 'comment' : 'comments'}`;
    for (const count of root.querySelectorAll(
      '[data-planr-action="feedback"] .planr-count, .planr-review-rail > header .planr-count',
    )) {
      count.textContent = String(pins.length);
      count.setAttribute('aria-label', label);
    }
    const commentsButton = root.querySelector('[data-planr-action="feedback"]');
    commentsButton?.setAttribute('aria-label', commentsButton.dataset.planrReviewLabel || label);
    if (commentsButton?.dataset.planrReviewLabel)
      commentsButton.setAttribute('aria-description', label);
  };

  const render = ({ capture = true } = {}) => {
    if (composing) {
      renderQueued = true;
      return;
    }
    if (capture) captureDrafts();
    const focus = focusDescriptor();
    const scroll = [];
    for (let node = slot; node && root.contains(node); node = node.parentElement)
      scroll.push([node, node.scrollTop, node.scrollLeft]);
    const state = controller.getState();
    const { review, activePinId } = state;
    const allPins = review?.pins ?? [];
    const pins =
      typeof presentation.filterPin === 'function'
        ? allPins.filter((pin) => presentation.filterPin(pin, state))
        : allPins;
    const activeIndex = pins.findIndex((pin) => pin.id === activePinId);
    // A selected pin beyond the loaded page is one extra card, never thousands.
    const visiblePins = pins.slice(0, visibleLimit);
    if (activeIndex >= visibleLimit) visiblePins.push(pins[activeIndex]);
    const fragment = document.createDocumentFragment();
    const list = createElement(document, 'div', {
      className: 'planr-thread-list',
      attributes: { 'aria-label': 'Comment threads' },
    });
    if (pins.length === 0) {
      list.append(
        createElement(document, 'p', {
          className: 'planr-review-empty',
          text:
            typeof presentation.emptyMessage === 'string'
              ? presentation.emptyMessage
              : allPins.length
                ? 'No comments match these filters.'
                : 'No comments yet. Choose Add comment, then select a point or region in the artifact.',
        }),
      );
    } else {
      for (const pin of visiblePins) {
        const thread = renderThread(document, pin, pin.id === activePinId, {
          ...presentation.describePin?.(pin, state),
          compact: presentation.compact === true,
          replyLimit: expandedHistory.get(pin.id) || 2,
          commentExpanded: expandedComments.has(pin.id),
          replyExpanded: expandedReplies.has(pin.id),
        });
        presentation.decorateThread?.({ element: thread, pin, state, document });
        const reply = thread.querySelector('[name="reply"]');
        if (replyDrafts.has(pin.id)) reply.value = replyDrafts.get(pin.id);
        thread.querySelector('.planr-reply-send').disabled = !reply.value.trim();
        for (const field of thread.querySelectorAll('[data-planr-draft-key]')) {
          if (extraDrafts.has(field.dataset.planrDraftKey))
            field.value = extraDrafts.get(field.dataset.planrDraftKey);
        }
        list.append(thread);
      }
    }
    if (pins.length > visibleLimit)
      list.append(
        createElement(document, 'button', {
          className: 'planr-threads-more',
          text: `Show more comments · ${Math.min(visibleLimit, pins.length)} of ${pins.length}`,
          attributes: { type: 'button', 'data-planr-threads-more': '' },
        }),
      );
    fragment.append(list);
    slot.replaceChildren(fragment);
    const identityName = controller.getIdentity()?.name ?? '';
    if (document.activeElement !== identityInput) identityInput.value = identityName;
    if (identityStatus) {
      identityStatus.dataset.planrIdentityReady = String(Boolean(identityName));
      identityStatus.textContent = identityName
        ? `Comments will appear as ${identityName}.`
        : 'Used to sign your comments.';
    }
    overall.maxLength = ARTIFACT_REVIEW_LIMITS.text;
    if (!overallDirty && document.activeElement !== overall) overall.value = review?.overall ?? '';
    for (const button of decisionButtons) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.planrDecision === (review?.decision ?? 'pending')),
      );
    }
    decisionStatus.textContent = decisionCopy(review?.decision ?? 'pending');
    updateCounts(allPins);
    restoreFocus(focus);
    for (const [node, top, left] of scroll) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    const openMetric = root.querySelector('[data-planr-metric="open"]');
    if (openMetric)
      openMetric.textContent = `${allPins.filter(({ status }) => status !== 'resolved').length} open`;
  };

  const focusThread = (pinId) => {
    const thread = document.getElementById(artifactReviewThreadDomId(pinId));
    thread?.focus({ preventScroll: true });
    thread?.scrollIntoView?.({ block: 'nearest' });
  };

  const emitReview = (review) => {
    const detail = cloneFrozenArtifactReview(review);
    root.dispatchEvent(
      new window.CustomEvent(ARTIFACT_REVIEW_CHANGE_EVENT, {
        detail,
        bubbles: true,
      }),
    );
  };

  const unsubscribe = controller.subscribe((state, change) => {
    if (destroyed) return;
    if (['review', 'review-replaced', 'selection'].includes(change.type)) render();
    if (['review', 'review-replaced'].includes(change.type) && state.review)
      emitReview(state.review);
  });

  const onInput = (event) => {
    if (event.target !== identityInput) return;
    try {
      controller.setIdentity(event.target.value ? { name: event.target.value } : null);
      const name = controller.getIdentity()?.name ?? '';
      if (identityStatus) {
        identityStatus.dataset.planrIdentityReady = String(Boolean(name));
        identityStatus.textContent = name
          ? `Comments will appear as ${name}.`
          : 'Used to sign your comments.';
      }
      clearError();
    } catch (error) {
      showError(error);
    }
  };

  const setReplyExpanded = (pinId, expanded, { focus = false } = {}) => {
    const thread = document.getElementById(artifactReviewThreadDomId(pinId));
    const form = thread?.querySelector('[data-planr-reply-form]');
    const toggle = thread?.querySelector('[data-planr-reply-toggle]');
    if (!form || !toggle) return;
    if (expanded) expandedReplies.add(pinId);
    else expandedReplies.delete(pinId);
    form.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? '− Reply' : '+ Reply';
    toggle.title = expanded ? 'Collapse reply' : 'Reply to this comment';
    if (focus)
      (expanded ? form.elements.namedItem('reply') : toggle).focus({ preventScroll: true });
    emitDraftChange();
  };
  const onKeyDown = (event) => {
    const form = event.target?.closest?.('[data-planr-reply-form]');
    if (!form || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setReplyExpanded(form.dataset.planrReplyForm, false, { focus: true });
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (form.elements.namedItem('reply').value.trim()) form.requestSubmit();
    }
  };

  const emitSelection = (pinId) => {
    controller.selectPin(pinId);
    root.dispatchEvent(
      new window.CustomEvent(ARTIFACT_REVIEW_SELECT_EVENT, {
        detail: deepFreezeArtifactReview({ pinId, source: 'thread' }),
        bubbles: true,
      }),
    );
    onSelectPin?.(pinId);
  };

  const onClick = (event) => {
    if (event.target.closest?.('[data-planr-threads-more]')) {
      visibleLimit += presentation.pageSize || 40;
      render();
      return;
    }
    const historyToggle = event.target.closest?.('[data-planr-history-expand]');
    if (historyToggle) {
      const id = historyToggle.dataset.planrHistoryExpand;
      expandedHistory.set(id, (expandedHistory.get(id) || 2) + 20);
      render();
      return;
    }
    const commentToggle = event.target.closest?.('[data-planr-comment-expand]');
    if (commentToggle) {
      const id = commentToggle.dataset.planrCommentExpand;
      if (expandedComments.has(id)) expandedComments.delete(id);
      else expandedComments.add(id);
      render();
      return;
    }
    const replyToggle = event.target?.closest?.('[data-planr-reply-toggle]');
    if (replyToggle) {
      setReplyExpanded(
        replyToggle.dataset.planrReplyToggle,
        replyToggle.getAttribute('aria-expanded') !== 'true',
        { focus: true },
      );
      return;
    }
    const action = event.target?.closest?.('[data-planr-thread-action]');
    const focus = event.target?.closest?.('[data-planr-thread-focus]');
    if (action) {
      try {
        const pinId = action.dataset.planrPinId;
        controller.dispatch({
          type: 'set-status',
          pinId,
          status: action.dataset.planrThreadAction === 'resolve' ? 'resolved' : 'open',
        });
        announce(
          action.dataset.planrThreadAction === 'resolve' ? 'Comment resolved' : 'Comment reopened',
        );
        focusThread(pinId);
        clearError();
      } catch (error) {
        showError(error);
      }
      return;
    }
    if (focus) emitSelection(focus.dataset.planrThreadFocus);
  };

  const onSubmit = (event) => {
    const form = event.target?.closest?.('[data-planr-reply-form]');
    if (!form) return;
    event.preventDefault();
    const textarea = form.elements.namedItem('reply');
    const comment = textarea.value;
    if (!comment.trim()) return;
    const wasExpanded = expandedReplies.has(form.dataset.planrReplyForm);
    try {
      textarea.setAttribute('aria-invalid', 'false');
      textarea.value = '';
      replyDrafts.delete(form.dataset.planrReplyForm);
      expandedReplies.delete(form.dataset.planrReplyForm);
      controller.dispatch({
        type: 'add-reply',
        pinId: form.dataset.planrReplyForm,
        comment,
      });
      emitDraftChange();
      announce('Reply added');
      focusThread(form.dataset.planrReplyForm);
      clearError();
    } catch (error) {
      textarea.value = comment;
      replyDrafts.set(form.dataset.planrReplyForm, comment);
      if (wasExpanded) expandedReplies.add(form.dataset.planrReplyForm);
      textarea?.setAttribute('aria-invalid', 'true');
      showError(error);
      textarea?.focus();
    }
  };

  const onOverallChange = () => {
    try {
      const value = overall.value;
      controller.dispatch({ type: 'set-overall', overall: value });
      overallDirty = false;
      announce('Overall note updated');
      clearError();
    } catch (error) {
      showError(error);
    }
  };

  const onDecision = (event) => {
    try {
      const selected = event.currentTarget.dataset.planrDecision;
      const decision = controller.getReview()?.decision === selected ? 'pending' : selected;
      controller.dispatch({ type: 'set-decision', decision });
      announce(decisionCopy(decision));
      clearError();
    } catch (error) {
      showError(error);
    }
  };

  const onSelect = (event) => {
    if (event.detail?.source === 'thread' || typeof event.detail?.pinId !== 'string') return;
    try {
      controller.selectPin(event.detail.pinId);
      focusThread(event.detail.pinId);
    } catch (error) {
      showError(error);
    }
  };

  let lastOpened = null;
  const onThreadOpen = (event) => {
    const thread = event.target.closest?.('.planr-thread[data-planr-pin-id]');
    if (!thread || !slot.contains(thread)) return;
    const pin = controller
      .getReview()
      ?.pins.find((entry) => entry.id === thread.dataset.planrPinId);
    const key = pin && `${pin.id}:${pin.replies.map((reply) => reply.id).join(',')}`;
    if (!key || lastOpened === key) return;
    lastOpened = key;
    presentation.onThreadOpen?.(pin.id, controller.getState());
    root.dispatchEvent(
      new window.CustomEvent('planr:artifact-thread-open', {
        bubbles: true,
        detail: Object.freeze({ pinId: pin.id }),
      }),
    );
  };
  const onDraftInput = (event) => {
    const form = event.target.closest?.('[data-planr-reply-form]');
    if (form)
      form.querySelector('.planr-reply-send').disabled = !form.elements
        .namedItem('reply')
        .value.trim();
    emitDraftChange();
  };
  const onOverallInput = () => {
    overallDirty = true;
    emitDraftChange();
  };
  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = () => {
    composing = false;
    if (renderQueued) {
      renderQueued = false;
      render();
    }
  };
  slot.addEventListener('input', onDraftInput);
  slot.addEventListener('focusin', onThreadOpen);
  slot.addEventListener('click', onThreadOpen);
  slot.addEventListener('compositionstart', onCompositionStart);
  slot.addEventListener('compositionend', onCompositionEnd);
  overall.addEventListener('input', onOverallInput);
  identityInput.addEventListener('input', onInput);
  slot.addEventListener('click', onClick);
  slot.addEventListener('submit', onSubmit);
  slot.addEventListener('keydown', onKeyDown);
  overall.addEventListener('change', onOverallChange);
  for (const button of decisionButtons) button.addEventListener('click', onDecision);
  root.addEventListener(ARTIFACT_REVIEW_SELECT_EVENT, onSelect);
  render();

  return Object.freeze({
    controller,
    getReview: () => controller.getReview(),
    getState: () => controller.getState(),
    getIdentity: () => controller.getIdentity(),
    setIdentity: (value) => controller.setIdentity(value),
    dispatch: (action) => controller.dispatch(action),
    replaceReview: (review) => controller.replaceReview(review),
    selectPin: (pinId) => controller.selectPin(pinId),
    render,
    setPresentation(options = {}) {
      if (
        options.filterKey !== presentation.filterKey ||
        (options.pageSize !== undefined && options.pageSize !== presentation.pageSize)
      )
        visibleLimit = options.pageSize || presentation.pageSize || Infinity;
      presentation = { ...presentation, ...options };
      render();
    },
    snapshotDrafts,
    getReviewOf: () => controller.getReview()?.reviewOf ?? reviewOf,
    restoreDrafts(snapshot) {
      const digest = controller.getReview()?.reviewOf ?? reviewOf;
      if (!snapshot || snapshot.reviewOf !== digest) return false;
      // Identity notifications synchronously render and capture current fields.
      // Apply them before restoring the saved drafts, so blank startup fields
      // cannot overwrite the snapshot we are about to restore.
      if (typeof snapshot.identity === 'string') {
        const name = snapshot.identity.slice(0, ARTIFACT_REVIEW_LIMITS.authorName);
        controller.setIdentity(name.trim() ? { ...controller.getIdentity(), name } : null);
      }
      for (const [id, value] of Object.entries(snapshot.replies ?? {}).slice(
        0,
        ARTIFACT_REVIEW_LIMITS.pins,
      )) {
        if (id.length <= ARTIFACT_REVIEW_LIMITS.id && typeof value === 'string')
          replyDrafts.set(id, value.slice(0, ARTIFACT_REVIEW_LIMITS.text));
      }
      expandedReplies.clear();
      const expanded = Array.isArray(snapshot.expandedReplies)
        ? snapshot.expandedReplies
        : [...replyDrafts.keys()];
      for (const id of expanded.slice(0, ARTIFACT_REVIEW_LIMITS.pins))
        if (typeof id === 'string' && id.length <= ARTIFACT_REVIEW_LIMITS.id)
          expandedReplies.add(id);
      for (const [key, value] of Object.entries(snapshot.fields ?? {}).slice(
        0,
        ARTIFACT_REVIEW_LIMITS.pins,
      )) {
        if (key.length <= 512 && typeof value === 'string')
          extraDrafts.set(key, value.slice(0, ARTIFACT_REVIEW_LIMITS.text));
      }
      overallDirty = snapshot.overall?.dirty === true;
      if (overallDirty && typeof snapshot.overall?.value === 'string')
        overall.value = snapshot.overall.value.slice(0, ARTIFACT_REVIEW_LIMITS.text);
      render({ capture: false });
      return true;
    },
    focusThread,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      slot.removeEventListener('input', onDraftInput);
      slot.removeEventListener('focusin', onThreadOpen);
      slot.removeEventListener('click', onThreadOpen);
      slot.removeEventListener('compositionstart', onCompositionStart);
      slot.removeEventListener('compositionend', onCompositionEnd);
      overall.removeEventListener('input', onOverallInput);
      identityInput.removeEventListener('input', onInput);
      slot.removeEventListener('click', onClick);
      slot.removeEventListener('submit', onSubmit);
      slot.removeEventListener('keydown', onKeyDown);
      overall.removeEventListener('change', onOverallChange);
      for (const button of decisionButtons) button.removeEventListener('click', onDecision);
      root.removeEventListener(ARTIFACT_REVIEW_SELECT_EVENT, onSelect);
      if (ownsController) controller.destroy();
    },
  });
}
