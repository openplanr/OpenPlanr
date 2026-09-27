import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toCliFailureEnvelope } from '../../src/cli/error-boundary.js';
import {
  describeSchemaIssues,
  ExternalJsonError,
  parseExternalJson,
} from '../../src/utils/external-json.js';

const schema = z.object({ name: z.string(), count: z.number().optional() });

function failure(run: () => unknown): ExternalJsonError {
  try {
    run();
  } catch (error) {
    if (error instanceof ExternalJsonError) return error;
    throw error;
  }
  throw new Error('expected an ExternalJsonError');
}

describe('parseExternalJson', () => {
  it('returns the validated value', () => {
    expect(parseExternalJson('{"name":"planr","extra":true}', schema, 'fixture')).toEqual({
      name: 'planr',
    });
  });

  it('names the source and the parser detail for text that is not JSON', () => {
    const error = failure(() => parseExternalJson('Warning: {', schema, 'gh repo view'));
    expect(error.code).toBe('E_EXTERNAL_JSON_INVALID');
    expect(error.message).toMatch(/^gh repo view is not valid JSON: /u);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('never echoes the parser message, which quotes input, for a secret document', () => {
    const error = failure(() =>
      parseExternalJson('{"linear": lin_api_secret}', schema, 'credentials.json', {
        secret: true,
      }),
    );
    expect(error.message).toBe('credentials.json is not valid JSON.');
    expect(error.message).not.toContain('lin_api_secret');
    expect(error.cause).toBeUndefined();
  });

  it('names every off-schema field by its path', () => {
    const error = failure(() => parseExternalJson('{"count":"3"}', schema, 'fixture'));
    expect(error.message).toBe(
      'fixture has an unexpected shape: name: Invalid input: expected string, received undefined; count: Invalid input: expected number, received string',
    );
  });

  it('renders as a coded failure envelope', () => {
    const error = failure(() => parseExternalJson('[]', schema, 'claude plugin list --json'));
    expect(toCliFailureEnvelope(error)).toEqual({
      ok: false,
      code: 'E_EXTERNAL_JSON_INVALID',
      problem:
        'claude plugin list --json has an unexpected shape: (root): Invalid input: expected object, received array',
    });
  });
});

describe('describeSchemaIssues', () => {
  it('lists the alternatives of a union with their own paths', () => {
    const union = z.union([z.array(z.string()), z.object({ items: z.array(z.string()) })]);
    const result = union.safeParse({ items: [1] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(describeSchemaIssues(result.error)).toBe(
      '(root): Invalid input: expected array, received object | items.0: Invalid input: expected string, received number',
    );
  });
});
