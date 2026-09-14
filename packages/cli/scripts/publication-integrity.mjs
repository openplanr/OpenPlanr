export function classifyPublicationIntegrity({ publishedIntegrity, candidateIntegrity }) {
  if (publishedIntegrity === null) return 'absent';
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(publishedIntegrity)) {
    throw new Error('The registry returned an invalid package integrity value.');
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(candidateIntegrity)) {
    throw new Error('The candidate package has an invalid integrity value.');
  }
  return publishedIntegrity === candidateIntegrity ? 'identical' : 'conflict';
}
