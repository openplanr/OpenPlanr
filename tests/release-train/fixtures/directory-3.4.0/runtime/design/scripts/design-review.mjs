// design-review.mjs:1511-1512
export async function listArtifactReviewServers({ env = process.env, fetchImpl = fetch } = {}) {
  return { env, fetchImpl };
}
