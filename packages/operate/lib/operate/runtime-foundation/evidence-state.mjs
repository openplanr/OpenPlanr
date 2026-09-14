/** Explicit evidence and durable-state dependencies for the Operate runtime foundation. */
export {
  buildOperatingEvidenceMaterializationV2,
  deriveOperatingEvidenceEdgeIdV2,
  deriveOperatingEvidenceRequestHashV2,
  readOperatingArtifactRawBytesV2,
  setOperatingEvidenceMaterializationBlobV2,
  stageOperatingEvidenceMaterializationBlobV2,
  validateOperatingEvidenceSourcePayloadV2,
} from '../evidence-materialization-v2.mjs';
export { assertOperatingModelStateV2 } from '../operating-state-v2.mjs';
export {
  assertOperatingSnapshotV2,
  buildOperatingSnapshotStateTransactionV2,
} from '../operating-snapshots-v2.mjs';
export {
  assertOperatingDeltaV2,
  classifyOperatingDeltaMaterialityV2,
  deriveOperatingDeltaV2,
} from '../operating-delta-v2.mjs';
