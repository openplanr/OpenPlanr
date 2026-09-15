import { toDiagnostic } from './diagnostics.mjs';
import { AUTHORING_RESULT_KIND, AUTHORING_RESULT_VERSION } from './command-contract.mjs';

function envelope(command, status) {
  return {
    kind: AUTHORING_RESULT_KIND,
    contractVersion: AUTHORING_RESULT_VERSION,
    command,
    status,
  };
}

/** Convert an authoring operation into the shared stable result envelope. */
export function runOperation(command, operation) {
  try {
    return Object.freeze({
      ...envelope(command, 'completed'),
      ok: true,
      exit: 0,
      diagnostics: [],
      ...operation(),
    });
  } catch (error) {
    return Object.freeze({
      ...envelope(command, 'failed'),
      ok: false,
      exit: error?.usage ? 2 : 1,
      diagnostics: [toDiagnostic(error)],
    });
  }
}
