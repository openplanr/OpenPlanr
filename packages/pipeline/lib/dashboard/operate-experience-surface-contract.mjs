import { validateJson } from '../protocol/json-schema.mjs';
import {
  OPERATE_ALLOWED_ACTION_SCHEMA as allowedActionSchema,
  OPERATING_DELIVERY_ROUTE_SCHEMA as deliveryRouteSchema,
  OPERATING_EVIDENCE_RESOLUTION_SCHEMA as evidenceResolutionSchema,
  OPERATING_EXECUTION_RESULT_SCHEMA as executionResultSchema,
  OPERATE_EXPERIENCE_VIEW_SCHEMA as experienceViewSchema,
  OPERATING_FINDING_SCHEMA as findingSchema,
  OPERATING_GOVERNED_OPERATION_SCHEMA as governedOperationSchema,
  OPERATING_REVIEW_SCHEMA as reviewSchema,
  OPERATING_TRACE_MATRIX_SCHEMA as traceMatrixSchema,
  OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA as reviewWorkspaceSchema,
  OPERATE_EXPERIENCE_SURFACE_SCHEMA as surfaceSchema,
} from './generated/operate-experience-surface-schema-data.mjs';

const schemas = new Map([
  ['operate-experience-view.schema.json', experienceViewSchema],
  ['operating-finding.schema.json', findingSchema],
  ['operate-allowed-action.schema.json', allowedActionSchema],
  ['operating-delivery-route.schema.json', deliveryRouteSchema],
  ['operating-evidence-resolution.schema.json', evidenceResolutionSchema],
  ['operating-execution-result.schema.json', executionResultSchema],
  ['operating-governed-operation.schema.json', governedOperationSchema],
  ['operating-review.schema.json', reviewSchema],
  ['operating-trace-matrix.schema.json', traceMatrixSchema],
  ['operate-review-display-workspace.schema.json', reviewWorkspaceSchema],
]);

function jsonPointer(root, fragment) {
  if (!fragment || fragment === '#') return root;
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

function resolveSurfaceRef(reference) {
  const [path, pointer = ''] = reference.split('#');
  const filename = path.split('/').at(-1);
  const rootSchema = schemas.get(filename);
  if (!rootSchema) return null;
  return {
    schema: jsonPointer(rootSchema, pointer ? `#${pointer}` : '#'),
    rootSchema,
    base: filename,
  };
}

export function validateOperateExperienceSurfaceV1(value) {
  const errors = validateJson(value, surfaceSchema, {
    base: 'schemas/v1.2.0/operate-experience-surface.schema.json',
    resolveRef: resolveSurfaceRef,
  });
  if (errors.length > 0) return errors;
  const summary = value.truthSummary;
  if (
    summary.sourceViewHash !== value.viewHash ||
    summary.sourceEventHead.sequence !== value.eventHead.sequence ||
    summary.sourceEventHead.hash !== value.eventHead.hash ||
    summary.stages.total !== summary.stages.cycles * 7 ||
    summary.evidence.linked > summary.evidence.total ||
    summary.proof.linkedEvidence !== summary.evidence.linked ||
    summary.seats.total !== summary.seats.terminal + summary.seats.active + summary.seats.pending
  ) {
    return [
      {
        path: '$.truthSummary',
        rule: 'sharedTruth',
        detail: 'does not bind one internally consistent shared truth summary',
      },
    ];
  }
  return [];
}

export function assertOperateExperienceSurfaceV1(value) {
  const errors = validateOperateExperienceSurfaceV1(value);
  if (errors.length > 0) {
    const error = new TypeError(
      `operate-experience-surface: ${errors[0].path} ${errors[0].detail}`,
    );
    error.code = 'E_OPERATE_EXPERIENCE_SURFACE_INVALID';
    throw error;
  }
  return value;
}

export const OPERATE_EXPERIENCE_SURFACE_SCHEMA_V1 = Object.freeze(structuredClone(surfaceSchema));
