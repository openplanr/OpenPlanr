import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { LARGE_OBJECT_LIMITS } from '../../lib/resource-limits.mjs';

it('keeps the CLI resource limit leaf byte-identical to its dependency-free Protocol authority', () => {
  for (const extension of ['mjs', 'd.mts']) {
    const canonical = readFileSync(
      resolve('../../packages/protocol/src', `large-object-limits.${extension}`),
    );
    const projected = readFileSync(resolve('lib', `resource-limits.${extension}`));
    expect(projected).toEqual(canonical);
  }
  expect(Object.isFrozen(LARGE_OBJECT_LIMITS)).toBe(true);
  expect(readFileSync(resolve('lib/resource-limits.mjs'), 'utf8')).not.toMatch(/\bimport\s/u);
});

it('prevents consumers from relaxing the canonical transport budget', () => {
  const prior = LARGE_OBJECT_LIMITS.decodedBytes;
  expect(Reflect.set(LARGE_OBJECT_LIMITS, 'decodedBytes', Number.MAX_SAFE_INTEGER)).toBe(false);
  expect(LARGE_OBJECT_LIMITS.decodedBytes).toBe(prior);
});
