/** The message of a thrown `Error`, or the thrown value itself as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
