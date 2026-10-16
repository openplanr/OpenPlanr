import '../../../../tests/support/isolate-user-state.mjs';
import { expect } from 'vitest';
import { byteBufferEquality } from '../helpers/byte-buffer-equality.js';

// Byte custody assertions compare exact Buffer lengths and bytes without per-index traversal.
expect.addEqualityTesters([byteBufferEquality]);
