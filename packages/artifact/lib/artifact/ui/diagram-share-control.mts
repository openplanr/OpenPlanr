interface ShareStatus {
  ok: boolean;
  shared: boolean;
  title: string;
  localRevision: string;
  destination: string;
  sourceDigest?: string;
  contents?: { elements: number; connections: number; sourceKind: 'manifest' | 'authoring' };
  url?: string;
  hasUpdate?: boolean;
  revoked?: boolean;
  deleted?: boolean;
  commentsPaused?: boolean;
  pendingAction?: string;
  pending?: boolean;
  token?: string;
  message?: string;
}
/** One reusable owner dialog. Opening it previews local content and never publishes. */
export function mountDiagramShareControl({
  root,
  apiBase,
}: {
  root: HTMLElement;
  apiBase: string;
}) {
  const doc = root.ownerDocument,
    win = doc.defaultView as Window & typeof globalThis;
  const dialog = doc.createElement('dialog');
  dialog.className = 'diagram-share-dialog';
  dialog.setAttribute('aria-label', 'Share diagram');
  // Foreground and surface are paired explicitly, including disabled controls, so a host
  // dark theme cannot recreate the unreadable primary button in the old design modal.
  dialog.style.cssText =
    'background:#151a24;color:#f1f5f9;border:1px solid #637084;border-radius:18px;padding:24px;width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif';
  const header = doc.createElement('header');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px';
  const heading = doc.createElement('h2');
  heading.textContent = 'Share diagram';
  heading.style.cssText = 'color:#f1f5f9;margin:0;font-size:24px';
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close share diagram');
  header.append(heading, close);
  dialog.append(header);
  const summary = doc.createElement('dl');
  summary.style.cssText =
    'background:#090d14;padding:16px;border-radius:12px;color:#f1f5f9;overflow-wrap:anywhere';
  dialog.append(summary);
  const publication = doc.createElement('p');
  publication.style.color = '#c8d3e2';
  publication.dataset.publicationContents = '';
  dialog.append(publication);
  const details = doc.createElement('details');
  const detailsTitle = doc.createElement('summary');
  detailsTitle.textContent = 'Publication details';
  details.append(detailsTitle);
  const detailsBody = doc.createElement('p');
  detailsBody.style.cssText = 'overflow-wrap:anywhere;color:#c8d3e2';
  details.append(detailsBody);
  dialog.append(details);
  const privacy = doc.createElement('p');
  privacy.textContent =
    'Publish an encrypted review your team can open while your laptop is offline. Share the link and access token separately. Reviewers can comment; editing stays local.';
  privacy.style.color = '#c8d3e2';
  dialog.append(privacy);
  const state = doc.createElement('p');
  state.setAttribute('role', 'status');
  dialog.append(state);
  const controls = doc.createElement('div');
  controls.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  dialog.append(controls);
  doc.body.append(dialog);
  let status: ShareStatus | null = null,
    busy = false,
    disposed = false;
  const style = (button: HTMLButtonElement, primary = false) => {
    button.style.cssText = `color:${primary ? '#052a28' : '#f1f5f9'};background:${primary ? '#67e8d5' : '#222c3b'};border:1px solid ${primary ? '#67e8d5' : '#71819a'};border-radius:8px;padding:9px 13px;font:inherit;cursor:pointer;opacity:${button.disabled ? '.62' : '1'}`;
  };
  style(close);
  close.onclick = () => dialog.close();
  const request = async (action?: string): Promise<ShareStatus> => {
    const response = await win.fetch(apiBase, {
      method: action ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: {
        'x-openplanr-owner': '1',
        ...(action ? { 'content-type': 'application/json' } : {}),
      },
      ...(action
        ? { body: JSON.stringify({ action, expectedRevision: status?.localRevision }) }
        : {}),
    });
    const value = (await response.json()) as ShareStatus;
    if (!response.ok || !value.ok) throw new Error(value.message ?? 'Sharing is unavailable.');
    return value;
  };
  function button(label: string, action: () => Promise<void> | void, primary = false) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = busy;
    style(button, primary);
    button.onclick = () => {
      void Promise.resolve(action()).catch((error) => {
        state.textContent = error instanceof Error ? error.message : 'Sharing is unavailable.';
      });
    };
    controls.append(button);
  }
  function render() {
    controls.replaceChildren();
    summary.replaceChildren();
    if (!status) return;
    for (const [name, value] of [
      ['Diagram', status.title],
      ['Revision', status.localRevision.slice(0, 12)],
      ['Destination', status.destination],
      ['Retention', 'Until revoked or deleted'],
    ]) {
      const term = doc.createElement('dt');
      term.textContent = name;
      term.style.color = '#b6c4d6';
      const detail = doc.createElement('dd');
      detail.textContent = value;
      detail.style.cssText = 'margin:0 0 8px;color:#f1f5f9';
      summary.append(term, detail);
    }
    publication.textContent = status.contents
      ? `Includes the saved scene, ${status.contents.elements} elements, ${status.contents.connections} connections, labels and reviewable details. Original source bytes, local paths and owner credentials are excluded.`
      : 'Includes the saved scene, labels, connections and reviewable details. Original source bytes, local paths and owner credentials are excluded.';
    detailsBody.textContent = `Published review digest: ${status.localRevision}. Source revision: ${status.sourceDigest ?? 'Unavailable'}.`;
    if (status.deleted || status.revoked) {
      state.textContent = 'This review is no longer accessible.';
      return;
    }
    if (status.pendingAction) {
      state.textContent = `Pending ${status.pendingAction}; retry to confirm.`;
      const pendingAction = status.pendingAction;
      button(`Retry ${pendingAction}`, () => run(pendingAction), true);
      return;
    }
    if (!status.shared) button('Create shared review', () => run('create'), true);
    else {
      state.textContent = status.hasUpdate
        ? 'Local changes are not published.'
        : 'This revision is published.';
      if (status.url) {
        const field = doc.createElement('input');
        field.readOnly = true;
        field.value = status.url;
        field.setAttribute('aria-label', 'Shared diagram link');
        field.style.cssText =
          'width:100%;background:#090d14;color:#f1f5f9;border:1px solid #71819a;padding:8px;border-radius:6px';
        controls.append(field);
        const url = status.url;
        button('Copy link', () => win.navigator.clipboard.writeText(url));
      }
      button('Copy access token', async () => {
        const access = await request('access');
        if (!access.token) throw new Error('The access token is unavailable.');
        await win.navigator.clipboard.writeText(access.token);
        state.textContent = 'Access token copied. Share it separately from the link.';
      });
      if (status.hasUpdate) button('Publish revision', () => run('publish'), true);
      button('Sync feedback', () => run('sync'));
      button(status.commentsPaused ? 'Resume comments' : 'Pause comments', () =>
        run(status?.commentsPaused ? 'resume' : 'pause'),
      );
      button('Rotate access token', () => run('rotate'));
      button('Revoke access', () => run('revoke'));
      button('Delete review', () => run('delete'));
    }
  }
  async function run(action: string) {
    if (busy || !status) return;
    busy = true;
    render();
    state.textContent = 'Confirming sharing operation…';
    let failure: string | null = null;
    try {
      await request(action);
      status = await request();
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Sharing is unavailable.';
      try {
        status = await request();
      } catch {
        // Keep the last confirmed state when even local status is unavailable.
      }
    } finally {
      busy = false;
      render();
      if (failure) state.textContent = failure;
    }
  }
  async function open() {
    if (disposed) return;
    if (!dialog.open) dialog.showModal();
    status = null;
    busy = true;
    controls.replaceChildren();
    summary.replaceChildren();
    publication.textContent = '';
    detailsBody.textContent = '';
    state.textContent = 'Checking the selected diagram…';
    try {
      status = await request();
      busy = false;
      render();
    } catch (error) {
      busy = false;
      state.textContent = error instanceof Error ? error.message : 'Sharing is unavailable.';
      button('Retry', () => open());
    }
  }
  const click = (event: Event) => {
    if ((event.target as Element).closest('[data-action="share-diagram"]')) void open();
  };
  root.addEventListener('click', click);
  return {
    open,
    dispose() {
      disposed = true;
      root.removeEventListener('click', click);
      dialog.close();
      dialog.remove();
    },
  };
}
