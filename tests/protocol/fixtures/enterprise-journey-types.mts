import type {
  EnterpriseArtifactPage,
  EnterpriseReviewProjection,
} from '../../../packages/protocol/src/enterprise-journey-contracts.mjs';

const filter = { kind: 'all', status: 'all', search: '' } as const;
const artifactQuery: EnterpriseArtifactPage['query'] = {
  organizationId: 'org',
  projectId: 'project',
  actorId: 'actor',
  scope: 'artifacts',
  filter,
};
const reviewQuery: EnterpriseReviewProjection['query'] = {
  organizationId: 'org',
  actorId: 'actor',
  scope: 'organization-reviews',
  filter,
};
const projectReviewQuery = { ...artifactQuery, scope: 'project-reviews' as const };
// @ts-expect-error Artifact pages do not accept review queries.
const wrongArtifact: EnterpriseArtifactPage['query'] = projectReviewQuery;
// @ts-expect-error Review projections do not accept artifact catalog queries.
const wrongReview: EnterpriseReviewProjection['query'] = artifactQuery;
void [artifactQuery, reviewQuery, wrongArtifact, wrongReview];
