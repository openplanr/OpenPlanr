import { describe, expect, it } from 'vitest';
import { classifyPublicationIntegrity } from '../../scripts/publication-integrity.mjs';

const A = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const B = `sha512-${Buffer.alloc(64, 2).toString('base64')}`;

describe('publication integrity', () => {
  it('publishes only absent versions and skips byte-identical versions', () => {
    expect(classifyPublicationIntegrity({ publishedIntegrity: null, candidateIntegrity: A })).toBe(
      'absent',
    );
    expect(classifyPublicationIntegrity({ publishedIntegrity: A, candidateIntegrity: A })).toBe(
      'identical',
    );
  });

  it('fails closed when a version exists with different or malformed bytes', () => {
    expect(classifyPublicationIntegrity({ publishedIntegrity: A, candidateIntegrity: B })).toBe(
      'conflict',
    );
    expect(() =>
      classifyPublicationIntegrity({
        publishedIntegrity: 'not-integrity',
        candidateIntegrity: A,
      }),
    ).toThrow(/invalid package integrity/u);
  });
});
