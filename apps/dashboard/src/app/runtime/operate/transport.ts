import {
  fetchOperateAuditDisplay,
  fetchOperateCycleDisplay,
  fetchOperateRootDisplay,
  queryIdentityFromRoot,
} from '../../runtime-reads.js';

export const operateTransport = Object.freeze({
  fetchAuditDisplay: fetchOperateAuditDisplay,
  fetchCycleDisplay: fetchOperateCycleDisplay,
  fetchRootDisplay: fetchOperateRootDisplay,
  identityFromRoot: queryIdentityFromRoot,
});
