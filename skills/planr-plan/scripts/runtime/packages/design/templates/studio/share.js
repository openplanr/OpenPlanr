/* Trusted local adapter. Owner credentials never enter this runtime. */
(() => {
  'use strict';
  const options = globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ || {};
  if (!options.shareUrl) return;
  const button = document.querySelector('[data-planr-action="share"]');
  if (!button) return;
  button.setAttribute('aria-label', 'Share design');
  let dialog, status, busy = false, opener;
  const element = (tag, text, attributes = {}) => {
    const node = document.createElement(tag); if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  async function request(action) {
    const response = await fetch(options.shareUrl, {
      method: action ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      ...(action ? { headers: { 'content-type': 'application/json', 'x-openplanr-design': '1' }, body: JSON.stringify({ action }) } : {}),
    });
    const value = await response.json();
    if (!response.ok || value.ok === false) throw new Error(value.error || 'Sharing is unavailable. Check the service connection and retry.');
    return value;
  }
  function announce(message, failure = false) {
    const node = dialog?.querySelector('[data-share-message]');
    if (node) { node.textContent = message; node.dataset.error = String(failure); }
  }
  function close() { if (busy) return; dialog?.close(); dialog?.remove(); dialog = null; opener?.focus(); }
  function action(label, name, tone) {
    const node = element('button', label, { type: 'button', 'data-share-action': name });
    if (tone) node.className = tone;
    node.addEventListener('click', () => run(name)); return node;
  }
  function render() {
    const content = dialog.querySelector('[data-share-content]'); content.replaceChildren();
    const details = element('dl');
    for (const [term, value] of [['Design', status.title], ['Revision', (status.publishedRevision || status.localRevision || '').slice(0, 12)], ['Retention', 'Until revoked or deleted']]) {
      details.append(element('dt', term), element('dd', value));
    }
    content.append(details);
    if (!status.shared || status.pending) {
      content.append(element('p', 'Publish an encrypted review that your team can open while your laptop is offline. Share the link and access token separately.'));
      content.append(action(status.pending ? `Retry ${status.pendingAction || 'sharing'}` : 'Create shared review', status.pendingAction || 'create', 'design-share-primary'));
      return;
    }
    if (status.deleted || status.revoked) {
      content.append(element('p', status.deleted ? 'This shared review was deleted.' : 'Access to this review was revoked.'));
      if (!status.deleted) content.append(action('Delete review', 'delete', 'design-share-danger'), action('Export recovery file', 'recovery'));
      return;
    }
    const link = element('input', '', { readonly: '', value: status.url, 'aria-label': 'Design review link' });
    const row = element('div', '', { class: 'design-share-copy-row' }); row.append(link, action('Copy link', 'copy-link')); content.append(row);
    const tokenRow = element('div', '', { class: 'design-share-copy-row' });
    tokenRow.append(element('span', 'Recipients enter the access token to open the design.'), action('Copy access token', 'copy-token')); content.append(tokenRow);
    const actions = element('div', '', { class: 'design-share-actions' });
    if (status.hasUpdate) actions.append(action('Publish update', 'publish', 'design-share-primary'));
    actions.append(action('Sync reviews', 'sync'), action(status.commentsPaused ? 'Resume comments' : 'Pause comments', status.commentsPaused ? 'resume' : 'pause'));
    content.append(actions);
    const management = element('details'); management.append(element('summary', 'Manage access'));
    const managementActions = element('div', '', { class: 'design-share-actions' });
    managementActions.append(action('Rotate access token', 'rotate'), action('Export recovery file', 'recovery'), action('Revoke access', 'revoke'), action('Delete review', 'delete', 'design-share-danger'));
    management.append(managementActions); content.append(management);
  }
  async function copy(value, message) {
    try { await navigator.clipboard.writeText(value); announce(message); }
    catch {
      // Clipboard permissions can fail; expose only the requested reviewer credential.
      const field = element('input', '', { readonly: '', value, 'aria-label': 'Copy this value' });
      dialog.querySelector('[data-share-content]').append(field); field.focus(); field.select(); announce('Select and copy the value above.');
    }
  }
  async function run(name) {
    if (busy) return;
    if (['rotate', 'revoke', 'delete'].includes(name)) {
      const messages = { rotate: 'Replace the access token? Everyone must enter the new token.', revoke: 'Revoke access for everyone using this shared review?', delete: 'Delete the hosted design and feedback? Your local design remains available.' };
      if (!window.confirm(messages[name])) return;
    }
    busy = true; dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button').forEach((node) => { node.disabled = true; }); announce('Working…');
    try {
      if (name === 'refresh') { status = await request(); render(); announce(''); }
      else if (name === 'copy-link') await copy(status.url, 'Review link copied.');
      else if (name === 'copy-token') { const value = await request('access'); await copy(value.token, 'Access token copied. Send it separately from the link.'); }
      else {
        const result = await request(name);
        if (name === 'recovery') announce(`Recovery file saved privately: ${result.output}`);
        else { status = await request(); render(); announce(name === 'rotate' ? 'Token rotated. Copy the new access token for your team.' : name === 'sync' ? (result.issues?.length ? `Feedback synchronized; ${result.issues.length} invalid events need attention. Open feedback diagnostics.` : 'Team reviews synchronized.') : 'Changes saved.'); }
      }
    } catch (error) { announce(error.message, true); }
    finally { busy = false; dialog?.removeAttribute('aria-busy'); dialog?.querySelectorAll('button').forEach((node) => { node.disabled = false; }); }
  }
  async function open() {
    if (dialog) return;
    opener = document.activeElement;
    dialog = element('dialog', '', { class: 'design-share-dialog', 'aria-labelledby': 'design-share-title' });
    const head = element('header'); head.append(element('h2', 'Share design', { id: 'design-share-title' }));
    const dismiss = element('button', '×', { type: 'button', 'aria-label': 'Close sharing' }); dismiss.addEventListener('click', close); head.append(dismiss);
    dialog.append(head, element('div', '', { 'data-share-content': '' }), element('p', 'Loading sharing settings…', { 'data-share-message': '', role: 'status', 'aria-live': 'polite' }));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    document.body.append(dialog); dialog.showModal();
    try { status = await request(); if (dialog) { render(); announce(''); } }
    catch (error) { announce(error.message, true); if (dialog) dialog.querySelector('[data-share-content]').append(action('Retry', 'refresh')); }
  }
  // Intercept before the shared generic dialog. This design adapter owns its flow.
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-planr-action="share"]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); open();
  }, true);
  // Periodic pull imports only published feedback, never publishes local changes.
  let syncing = false;
  const sync = async () => {
    if (syncing || document.hidden) return;
    syncing = true;
    try {
      const result = await request('sync');
      if (result.imported > 0 || result.issues?.length) {
        let notice = document.querySelector('[data-design-team-update]');
        if (!notice) { notice = element('button', '', { type: 'button', 'data-design-team-update': '', class: 'planr-toolbar-action' }); button.before(notice); }
        notice.textContent = result.issues?.length ? 'Feedback needs attention' : 'New team review';
        notice.onclick = () => {
          if (result.issues?.length) { open(); setTimeout(() => announce(`${result.issues.length} feedback events could not be accepted. Run the feedback utility to inspect the saved diagnostics.`, true), 300); }
          else if (window.confirm('Reload to show team feedback? Finish any unsaved comment before reloading.')) location.reload();
        };
      }
    } catch (error) {
      button.title = error.message;
    } finally { syncing = false; }
  };
  const timer = setInterval(sync, 15000);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
