import type { DiagramEditorSession, DiagramEditorState } from './session.mjs';

// This package-private seam is used only by trusted editor chrome. Bundle roots
// come from the engine's detached, fully validated, recursively frozen copies.
// Public session snapshots continue to clone every bundle.
const readers = new WeakMap<DiagramEditorSession, () => DiagramEditorState>();
export function registerEditorStateReader(
  session: DiagramEditorSession,
  reader: () => DiagramEditorState,
): void {
  if (readers.has(session)) throw new TypeError('Editor state reader already registered.');
  readers.set(session, reader);
}
export function readEditorState(session: DiagramEditorSession): DiagramEditorState {
  return readers.get(session)?.() ?? session.getState();
}
