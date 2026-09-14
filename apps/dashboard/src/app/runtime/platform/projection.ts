import {
  dashboardProductStatePolicy,
  isValidatedDashboardProductState,
  parseDashboardProductState,
} from '../../../lib/api/product-state.js';
import { parseDashboardSafeError } from '../../../lib/api/safe-errors.js';
import { DashboardValidationError } from '../../../lib/api/validation.js';

export const projectionRuntime = Object.freeze({
  ValidationError: DashboardValidationError,
  isValidatedState: isValidatedDashboardProductState,
  parseSafeError: parseDashboardSafeError,
  parseState: parseDashboardProductState,
  statePolicy: dashboardProductStatePolicy,
});

export type {
  DashboardProductState,
  DashboardProductStateKind,
} from '../../../lib/api/product-state.js';
export type { DashboardSafeError } from '../../../lib/api/safe-errors.js';
