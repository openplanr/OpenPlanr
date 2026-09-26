import { createDiagramEditorSession } from '../diagram/editor/session.mjs';
import { createDiagramEditorDraft } from '../diagram/editor/draft.mjs';
import { createDiagramEditorRecovery } from '../diagram/editor/recovery.mjs';
import { createDiagramLocalOwnerTransport } from '../diagram/editor/transport.mjs';
import { mountDiagramEditor } from './diagram-editor.mjs';

/** Thin owner host: authenticate before reading recovery; one shared editor owns interaction. */
export async function mountDiagramOwnerStudio(document = globalThis.document) {
  const window = document.defaultView;
  const root = document.getElementById('diagram-owner-editor');
  if (!root) return null;
  let disposed = false,
    session,
    mount;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', dispose);
    mount?.dispose();
    session?.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  try {
    const config = JSON.parse(document.getElementById('diagram-owner-data').textContent);
    const transport = createDiagramLocalOwnerTransport({
      apiBase: new URL('api/', window.location.href).href,
      origin: window.location.origin,
      fetch: window.fetch.bind(window),
    });
    const authoritative = await transport.read();
    if (disposed) return null;
    if (
      !authoritative.ok ||
      !['ready', 'absent'].includes(authoritative.status) ||
      authoritative.diagramId !== config.diagramId ||
      authoritative.capabilities?.read !== true ||
      typeof authoritative.capabilities?.write !== 'boolean' ||
      typeof authoritative.recoveryScope !== 'string'
    ) {
      throw new Error('The local owner could not verify access to this diagram.');
    }
    // A blocked sessionStorage getter must not prevent editing in memory. The
    // opaque scope comes only from the authenticated owner, never page content.
    let storage;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Explicit memory-only recovery. */
    }
    const recovery = createDiagramEditorRecovery({
      storage,
      scope: { sessionId: authoritative.recoveryScope, diagramId: authoritative.diagramId },
    });
    let bundle = authoritative.bundle;
    if (authoritative.status === 'absent') {
      const draft = createDiagramEditorDraft({
        diagramId: authoritative.diagramId,
        title: config.title,
        grammar: config.grammar,
      });
      if (!draft.ok) throw new Error('The initial diagram is not supported for editing.');
      bundle = draft.bundle;
    }
    session = createDiagramEditorSession({
      bundle,
      transport,
      recovery,
      capabilities: authoritative.capabilities,
      acknowledged: authoritative.status === 'ready',
    });
    mount = mountDiagramEditor({
      root,
      session,
      host: {
        async readCurrent() {
          const current = await transport.read();
          if (
            current?.ok &&
            current.status === 'ready' &&
            current.diagramId === authoritative.diagramId &&
            current.recoveryScope === authoritative.recoveryScope &&
            current.capabilities?.read === true
          )
            return current.bundle;
          throw new Error(
            'The current owner revision could not be read. Your pending changes remain in this session.',
          );
        },
      },
    });
    root.dataset.ownerReady = 'true';
    return { dispose };
  } catch {
    dispose();
    if (!root.isConnected) return null;
    root.replaceChildren();
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent =
      'The local diagram could not be opened. Access or storage may have changed. Existing files were not replaced; keep any other editing tab open.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry opening diagram';
    retry.addEventListener('click', () => window.location.reload(), { once: true });
    root.append(message, retry);
    return null;
  }
}

if (typeof document !== 'undefined' && document.getElementById('diagram-owner-editor'))
  void mountDiagramOwnerStudio();
