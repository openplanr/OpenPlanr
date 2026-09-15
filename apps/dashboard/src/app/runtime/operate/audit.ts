import { createOperateEvidenceDisplayValidator } from '../../../features/operate/evidence/evidence-model.js';
import { createOperateHistoryDisplayValidator } from '../../../features/operate/history/history-model.js';
import { createOperateOutcomeDisplayValidator } from '../../../features/operate/outcomes/outcome-model.js';

export const operateAuditRuntime = Object.freeze({
  createEvidenceValidator: createOperateEvidenceDisplayValidator,
  createHistoryValidator: createOperateHistoryDisplayValidator,
  createOutcomeValidator: createOperateOutcomeDisplayValidator,
});
