export {
  CHANGE_KINDS,
  VERSION_DIMENSIONS,
  assessVersionChange,
  assessVersionSet,
  classifyVersionBump,
  requiredVersionBump,
} from './compatibility.mjs';
export { analyzeSkillGraphImpact, planSkillGraphRollback } from './impact.mjs';
export { assessLearningPromotion, createLearningProposal } from './learning-proposals.mjs';
