import '../../../../tests/support/isolate-user-state.mjs';
import { afterEach, expect } from 'vitest';
import { byteBufferEquality } from '../helpers/byte-buffer-equality.js';
import {
  enableHostCliGuard,
  formatHostCliViolations,
  takeHostCliViolations,
} from './host-cli-guard.mjs';

// Byte custody assertions compare exact Buffer lengths and bytes without per-index traversal.
expect.addEqualityTesters([byteBufferEquality]);

const isolatedHome = process.env.OPENPLANR_TEST_ISOLATED_HOME;
if (!isolatedHome) throw new Error('The host CLI guard requires the isolated test home.');
enableHostCliGuard(isolatedHome);

afterEach(() => {
  const violations = takeHostCliViolations();
  if (violations.length) throw new Error(formatHostCliViolations(violations));
});
