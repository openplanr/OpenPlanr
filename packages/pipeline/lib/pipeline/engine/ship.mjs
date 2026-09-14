/** Explicit SHIP custody, provenance, risk, and closure surface consumed by the engine. */
export { assertPathCustody } from '../ship-closure-persistence.mjs';
export { normalizeRepositories } from '../ship-closure-identity.mjs';
export { appendProvenanceEvent, createProvenanceEvent } from '../provenance.mjs';
export { BROWSER_SURFACES, SHIP_SPECIALIST_IDS, classifyShipRisk } from '../ship-risk.mjs';
export {
  loadSpecOperatingOrigin,
  projectPipelineOperatingOriginCorrelation,
  projectSpecOperatingOrigin,
} from '../operate-origin.mjs';
export {
  advanceStoredShipClosure,
  createShipClosure,
  finalizeStoredShipClosure,
  inspectStoredShipClosureForLanding,
  listShipClosureSummaries,
  readShipClosure as readStoredShipClosure,
  reopenStoredShipClosure,
  resolveShipClosureConfiguration,
  runStoredShipGates,
} from '../ship-closure.mjs';
