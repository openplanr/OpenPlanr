import { describe, expect, it } from 'vitest';
import { CliBoundaryError, toCliFailureEnvelope } from '../../src/cli/error-boundary.js';

describe('public failure text', () => {
  it('keeps scoped package names and redacts local paths', () => {
    const envelope = toCliFailureEnvelope(
      new CliBoundaryError(
        'E_TEST',
        'Install @openplanr/pipeline; /Users/me/project/x.json and C:\\Users\\me\\x.json are local.',
        { recovery: 'Load @openplanr/pipeline/dashboard from /opt/cache/pkg then retry.' },
      ),
    );
    expect(envelope).toMatchObject({
      code: 'E_TEST',
      problem: 'Install @openplanr/pipeline; <path> and <path> are local.',
      recovery: 'Load @openplanr/pipeline/dashboard from <path> then retry.',
    });
  });

  it('still redacts paths after an email-style address', () => {
    const envelope = toCliFailureEnvelope(
      new CliBoundaryError('E_TEST', 'Fetching user@example.com/private failed.'),
    );
    expect(envelope.problem).toBe('Fetching user@example.com<path> failed.');
  });
});
