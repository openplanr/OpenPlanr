import { parseId } from '../../services/id-service.js';
import { CliBoundaryError } from '../error-boundary.js';

/**
 * Return `value` when it is shaped like an artifact id, else reject the positional argument.
 * Ids become file-name patterns and paths, so nothing else may reach the services.
 */
export function requireArtifactId(value: string, argument: string, example: string): string {
  if (parseId(value)) return value;
  throw new CliBoundaryError(
    'E_ARTIFACT_ID_INVALID',
    `<${argument}> must be an artifact id such as ${example} (uppercase prefix, hyphen, three or more digits); received ${JSON.stringify(value)}.`,
  );
}
