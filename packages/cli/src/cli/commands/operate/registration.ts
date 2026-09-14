/** Stable public entrypoint for the decomposed Operate command registrars. */

export type {
  OperateCommandRegistrationDependencies,
  OperateNoteContractVersion,
  OperateNoteContractVersionSelector,
  OperateNoteContractVersionSource,
  OperateNoteValidationProfile,
  OperateNoteValidationResult,
} from './registrars/contracts.js';
export { registerOperateCommandDefinition } from './registrars/index.js';
