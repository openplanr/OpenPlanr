import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isContained } from '../../src/services/pipeline-package-service.js';

describe('isContained', () => {
  const root = '/work/proj';

  it('rejects a sibling folder whose name extends the root name', () => {
    expect(isContained(root, path.resolve(root, '../proj-secrets/key.pem'))).toBe(false);
    expect(isContained(root, '/work/proj-secrets/key.pem')).toBe(false);
  });

  it('accepts paths inside the root and rejects the root itself', () => {
    expect(isContained(root, '/work/proj/a')).toBe(true);
    expect(isContained(root, path.resolve(root, './a'))).toBe(true);
    expect(isContained(root, root)).toBe(false);
  });
});
