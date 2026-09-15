/** Normalize dashboard custody heads into audit-binding form (hash required). */
export function exactAuditEventHead(
  head: Readonly<{ sequence: number; hash: string | null }> | null,
): Readonly<{ sequence: number; hash: string }> | null {
  if (head === null || head.hash === null) return null;
  return Object.freeze({ sequence: head.sequence, hash: head.hash });
}
