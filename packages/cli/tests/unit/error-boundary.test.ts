import { describe, expect, it } from 'vitest';
import { toCliFailureEnvelope } from '../../src/cli/error-boundary.js';

describe('toCliFailureEnvelope', () => {
  it('keeps relative paths readable and hides absolute ones', () => {
    const error = Object.assign(
      new Error(
        'Files in the codex runtime package 2.2641.0 were changed outside OpenPlanr: skills/delegate/scripts/context.mjs.',
      ),
      { code: 'E_RUNTIME_PACKAGE_CHANGED', recovery: 'Compare /Users/owner/.planr/runtime first.' },
    );
    expect(toCliFailureEnvelope(error)).toEqual({
      ok: false,
      code: 'E_RUNTIME_PACKAGE_CHANGED',
      problem:
        'Files in the codex runtime package 2.2641.0 were changed outside OpenPlanr: skills/delegate/scripts/context.mjs.',
      recovery: 'Compare <path> first.',
    });
  });

  it.each([
    ['at /Users/owner/project/x.md', 'at <path>'],
    ['"/srv/data/file.json"', '"<path>"'],
    ['C:\\Users\\owner\\x.md failed', '<path> failed'],
    ['https://example.com/a/b', 'https:<path>'],
  ])('redacts %s', (text, redacted) => {
    expect(toCliFailureEnvelope(new Error(text)).problem).toBe(redacted);
  });
});
