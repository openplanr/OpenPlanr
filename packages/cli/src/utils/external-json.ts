import type { z } from 'zod';

type SchemaIssue = z.ZodError['issues'][number];

/** JSON from a child process, credential file or published document that is unreadable or off-schema. */
export class ExternalJsonError extends Error {
  readonly code = 'E_EXTERNAL_JSON_INVALID';

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ExternalJsonError';
  }
}

function describeIssue(issue: SchemaIssue, parent: readonly PropertyKey[]): string {
  const path = [...parent, ...issue.path];
  if (issue.code === 'invalid_union' && issue.errors.length > 0) {
    return issue.errors
      .map((branch) => branch.map((inner) => describeIssue(inner, path)).join('; '))
      .join(' | ');
  }
  return `${path.map(String).join('.') || '(root)'}: ${issue.message}`;
}

/** Describe each schema issue as `path: message`; the alternatives of a union are joined by ` | `. */
export function describeSchemaIssues(error: z.ZodError): string {
  return error.issues.map((issue) => describeIssue(issue, [])).join('; ');
}

/**
 * Parse JSON the CLI did not write and validate it against `schema`; `source` names the file or
 * command in the error. A `secret` document never echoes the parser's message, which quotes input.
 */
export function parseExternalJson<T>(
  text: string,
  schema: z.ZodType<T>,
  source: string,
  options: { secret?: boolean } = {},
): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (options.secret) throw new ExternalJsonError(`${source} is not valid JSON.`);
    const detail = error instanceof Error ? error.message : String(error);
    throw new ExternalJsonError(`${source} is not valid JSON: ${detail}`, error);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ExternalJsonError(
      `${source} has an unexpected shape: ${describeSchemaIssues(result.error)}`,
      result.error,
    );
  }
  return result.data;
}
