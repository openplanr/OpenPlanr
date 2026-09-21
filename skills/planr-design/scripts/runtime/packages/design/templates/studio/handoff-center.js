/* Five-step Design Handoff Center. Domain decisions stay in server projections. */
(() => {
  'use strict';
  if (document.currentScript && !document.currentScript.isConnected) return;

  const q = (selector, parent = document) => parent.querySelector(selector);
  const node = (tag, text = '', attrs = {}) => {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    for (const [key, entry] of Object.entries(attrs)) if (entry !== undefined && entry !== null && entry !== false) value.setAttribute(key, entry);
    return value;
  };
  const action = (label, run, attrs = {}) => {
    const value = node('button', label, { type: 'button', ...attrs });
    value.addEventListener('click', run);
    return value;
  };
  const plainPackage = value => ({
    id: value.id,
    title: value.title,
    sources: structuredClone(value.sources || []),
    requirements: (value.requirements || []).map(({ id: _id, ...requirement }) => structuredClone(requirement)),
  });
  const requestId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const labels = { ready: 'Ready', pass: 'Complete', attention: 'Needs attention', blocked: 'Blocked', stale: 'Out of date', absent: 'Not available', approved: 'Approved', draft: 'Draft', superseded: 'Superseded', revoked: 'Revoked' };
  const steps = [
    ['readiness', 'Readiness'],
    ['review', 'Review resolution'],
    ['package', 'Implementation package'],
    ['approval', 'Owner approval'],
    ['plan', 'Continue to Plan'],
  ];

  let bridge, root, panel, opener, activeStep = 'readiness', serial = 0;
  const state = { readiness: null, review: null, implementation: null, errors: {} };

  const readiness = () => state.readiness?.readiness || state.readiness;
  const approvedReview = () => Boolean(state.review?.current && state.review?.draft?.status === 'approved');
  const packageDraft = () => state.implementation?.draft || null;
  const currentPackage = () => state.implementation?.current || null;
  const approvedPackage = () => currentPackage()?.status === 'approved';
  const statusFor = id => {
    if (state.errors[id === 'readiness' ? 'readiness' : id === 'review' ? 'review' : 'implementation']) return 'attention';
    if (id === 'readiness') return readiness()?.status || 'absent';
    if (id === 'review') return approvedReview() ? 'pass' : state.review?.draft ? (state.review.current ? 'attention' : 'stale') : 'blocked';
    if (id === 'package') return packageDraft() ? 'pass' : readiness()?.status === 'ready' ? 'attention' : 'blocked';
    if (id === 'approval') return approvedPackage() ? 'pass' : currentPackage()?.status || (packageDraft() ? 'attention' : 'blocked');
    return approvedPackage() ? 'ready' : 'blocked';
  };
  const badge = value => node('span', labels[value] || value, { class: 'design-handoff-badge', 'data-status': value });
  const paragraph = (text, className = '') => node('p', text, className ? { class: className } : {});
  const empty = (title, detail) => {
    const value = node('div', '', { class: 'design-handoff-empty' });
    value.append(node('strong', title), paragraph(detail));
    return value;
  };
  const sectionTitle = (eyebrow, title, detail) => {
    const block = node('header', '', { class: 'design-handoff-step-header' });
    block.append(node('span', eyebrow, { class: 'design-handoff-eyebrow' }), node('h3', title), paragraph(detail));
    return block;
  };
  const setStatus = (message, error = false) => {
    const live = q('[data-design-handoff-status]', panel);
    if (!live) return;
    live.textContent = message;
    live.dataset.error = String(error);
  };
  const setBusy = busy => {
    panel?.toggleAttribute('aria-busy', busy);
    panel && q('[data-design-handoff-refresh]', panel)?.toggleAttribute('disabled', busy);
  };
  const perform = async (message, work, success) => {
    setBusy(true); setStatus(message);
    try {
      await work();
      await refresh();
      setStatus(success);
    } catch (error) {
      setStatus(error?.message || 'The handoff action could not be completed. Refresh and try again.', true);
    } finally { setBusy(false); }
  };

  function renderProgress() {
    const progress = q('[data-design-handoff-progress]', panel);
    progress.replaceChildren();
    for (const [index, [id, label]] of steps.entries()) {
      const status = statusFor(id);
      const button = action(label, () => { activeStep = id; render(); q(`[data-handoff-step="${id}"]`, panel)?.focus(); }, {
        class: 'design-handoff-step',
        'data-handoff-step': id,
        'data-status': status,
        'aria-current': activeStep === id ? 'step' : undefined,
        'aria-label': `${index + 1}. ${label}: ${labels[status] || status}`,
      });
      button.prepend(node('span', String(index + 1).padStart(2, '0'), { 'aria-hidden': 'true' }));
      button.append(badge(status));
      progress.append(button);
    }
  }

  function recoveryAction(check) {
    const label = check.recoveryAction?.label || 'Return to the design';
    return action(label, () => {
      if (['resolve-review-decisions', 'resolve-review-blockers', 'approve-review-handoff'].includes(check.recoveryAction?.id)) {
        activeStep = 'review'; render();
      } else {
        close(); bridge.announce(`${check.message} ${label}.`);
      }
    }, { class: 'design-handoff-link' });
  }

  function renderReadiness(content) {
    const value = readiness();
    content.append(sectionTitle('Step 1 of 5', 'Readiness', 'Confirm the current design, verification and review evidence before preparing implementation work.'));
    if (state.errors.readiness) {
      content.append(empty('Readiness is temporarily unavailable', state.errors.readiness));
      content.append(action('Retry readiness', refresh, { class: 'design-primary' }));
      return;
    }
    if (!value || value.status === 'absent') {
      content.append(empty('No readiness projection yet', value?.message || 'Complete a local design render to compute handoff readiness.'));
      content.append(action(value?.nextAction?.label || 'Return to the design', close, { class: 'design-primary' }));
      return;
    }
    const summary = node('div', '', { class: 'design-handoff-summary' });
    summary.append(badge(value.status), node('strong', value.status === 'ready' ? 'This design can move into implementation packaging.' : `${value.blockers?.length || 0} blocking checks remain.`));
    content.append(summary);
    const list = node('ol', '', { class: 'design-handoff-checks' });
    for (const check of value.checks || []) {
      const item = node('li', '', { 'data-status': check.status });
      const body = node('div'); body.append(node('strong', check.message), badge(check.status));
      item.append(body);
      if (check.status !== 'pass') item.append(recoveryAction(check));
      list.append(item);
    }
    content.append(list);
    if (value.status === 'ready') content.append(action('Review resolved feedback', () => { activeStep = 'review'; render(); }, { class: 'design-primary' }));
    else if (value.nextActions?.[0]) content.append(recoveryAction({ message: 'Readiness needs attention.', recoveryAction: value.nextActions[0] }));
  }

  function reviewGroup(title, items) {
    const section = node('section', '', { class: 'design-handoff-review-group' });
    section.append(node('h4', `${title} · ${items?.length || 0}`));
    if (!items?.length) section.append(paragraph('None recorded.', 'design-muted'));
    for (const item of items || []) {
      const card = node('article');
      card.append(paragraph(item.text || item.statement || 'Review decision'));
      if (item.refinement) card.append(paragraph(item.refinement, 'design-handoff-refinement'));
      section.append(card);
    }
    return section;
  }

  function renderReview(content) {
    content.append(sectionTitle('Step 2 of 5', 'Review resolution', 'Turn current feedback into explicit accepted, open, deferred and declined decisions.'));
    if (state.errors.review) {
      content.append(empty('Review decisions could not be loaded', state.errors.review));
      content.append(action('Retry review decisions', refresh, { class: 'design-primary' }));
      return;
    }
    const response = state.review, draft = response?.draft;
    if (!draft) {
      content.append(empty('No review handoff has been prepared', 'Generate a proposal from the current comments. You will review every decision before approval.'));
      content.append(action('Generate review handoff', () => perform('Generating review decisions…', async () => {
        state.review = await bridge.updateReviewHandoff({ action: 'draft', version: 0 });
      }, 'Review decisions generated.'), { class: 'design-primary' }));
      return;
    }
    const status = response.current ? draft.status : 'stale';
    const summary = node('div', '', { class: 'design-handoff-summary' });
    summary.append(badge(status), node('strong', draft.content?.summary || (response.current ? 'Review decisions match this design.' : 'The design or feedback changed after this handoff was prepared.')));
    content.append(summary);
    const decisions = node('div', '', { class: 'design-handoff-review-groups' });
    decisions.append(
      reviewGroup('Accepted changes', draft.content?.agreedChanges),
      reviewGroup('Open questions', draft.content?.openQuestions),
      reviewGroup('Deferred', draft.content?.deferred),
      reviewGroup('Declined', draft.content?.rejected),
    );
    content.append(decisions);
    const label = approvedReview() ? 'Continue to implementation package' : response.current ? 'Review and approve decisions' : 'Regenerate current decisions';
    content.append(action(label, () => {
      if (approvedReview()) { activeStep = 'package'; render(); }
      else bridge.openReviewHandoff();
    }, { class: 'design-primary' }));
  }

  function packageEditor(source, { regenerate = false } = {}) {
    const form = node('form', '', { class: 'design-handoff-package-editor' });
    const editable = plainPackage(source);
    const title = node('input', '', { type: 'text', required: '', maxlength: '256', 'aria-label': 'Implementation package title' });
    title.value = editable.title;
    const titleLabel = node('label', 'Package title'); titleLabel.append(title); form.append(titleLabel);
    const requirements = node('div', '', { class: 'design-handoff-requirements' });
    const editors = editable.requirements.map((requirement, index) => {
      const card = node('fieldset'); card.append(node('legend', `${requirement.kind.replaceAll('-', ' ')} requirement ${index + 1}`));
      const statement = node('textarea', '', { required: '', maxlength: '16384', 'aria-label': `Requirement ${index + 1} statement` }); statement.value = requirement.statement;
      const verification = node('textarea', '', { required: '', maxlength: '16384', 'aria-label': `Requirement ${index + 1} verification` }); verification.value = requirement.verification.join('\n');
      const statementLabel = node('label', 'Requirement'); statementLabel.append(statement);
      const verificationLabel = node('label', 'Verification, one expectation per line'); verificationLabel.append(verification);
      card.append(statementLabel, verificationLabel); requirements.append(card);
      return { requirement, statement, verification };
    });
    form.append(requirements);
    const save = node('button', regenerate ? 'Create next package version' : 'Save implementation package', { type: 'submit', class: 'design-primary' });
    form.append(save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      editable.title = title.value.trim();
      editable.requirements = editors.map(({ requirement, statement, verification }) => ({
        ...requirement,
        statement: statement.value.trim(),
        verification: verification.value.split('\n').map(value => value.trim()).filter(Boolean),
      }));
      const input = regenerate
        ? { action: 'regenerate', requestId: requestId('regenerate'), package: editable }
        : { action: 'draft', package: editable };
      void perform(regenerate ? 'Creating a new package version…' : 'Saving the implementation package…', async () => {
        await bridge.updateImplementationHandoff(input);
      }, regenerate ? 'A new package version is ready for approval.' : 'Implementation package saved.');
    });
    return form;
  }

  function renderPackage(content) {
    content.append(sectionTitle('Step 3 of 5', 'Implementation package', 'Review traceable requirements and observable verification expectations. Integrity values stay in the contract and are hidden here.'));
    if (state.errors.implementation) {
      content.append(empty('Implementation package could not be loaded', state.errors.implementation));
      content.append(action('Retry implementation package', refresh, { class: 'design-primary' }));
      return;
    }
    const response = state.implementation, draft = response?.draft;
    if (!approvedReview() || readiness()?.status !== 'ready') {
      content.append(empty('Readiness must be complete first', 'Approve current review decisions and resolve every blocking readiness check before composing the implementation package.'));
      content.append(action('Return to readiness', () => { activeStep = 'readiness'; render(); }, { class: 'design-primary' }));
      return;
    }
    if (!draft) {
      const proposal = response?.proposal;
      if (!proposal) {
        content.append(empty('No package proposal is available', 'Refresh the current design render, then return here to prepare the implementation scope.'));
        content.append(action('Refresh package proposal', refresh, { class: 'design-primary' }));
        return;
      }
      content.append(paragraph(`${proposal.sources.length} approved sources · ${proposal.requirements.length} proposed requirements`, 'design-muted'));
      content.append(packageEditor(proposal));
      return;
    }
    const summary = node('div', '', { class: 'design-handoff-summary' });
    summary.append(badge(draft.status), node('strong', `${draft.title} · version ${draft.version}`));
    content.append(summary, paragraph(`${draft.sources.length} sources · ${draft.requirements.length} requirements`, 'design-muted'));
    const list = node('ol', '', { class: 'design-handoff-requirement-list' });
    for (const requirement of draft.requirements) {
      const item = node('li');
      item.append(node('strong', requirement.statement), paragraph(requirement.verification.join(' · '), 'design-muted'));
      list.append(item);
    }
    content.append(list);
    if (approvedPackage()) {
      const edit = node('details'); edit.append(node('summary', 'Prepare a revised package version'), packageEditor(draft, { regenerate: true })); content.append(edit);
    }
    content.append(action('Review owner approval', () => { activeStep = 'approval'; render(); }, { class: 'design-primary' }));
  }

  function renderApproval(content) {
    content.append(sectionTitle('Step 4 of 5', 'Owner approval', 'Approval records the exact package version and permits a later, separate Plan invocation.'));
    if (state.errors.implementation) {
      content.append(empty('Approval state could not be loaded', state.errors.implementation));
      content.append(action('Retry approval state', refresh, { class: 'design-primary' }));
      return;
    }
    const response = state.implementation, draft = response?.draft, current = response?.current, preview = response?.approvalPreview;
    if (!draft) {
      content.append(empty('No package is ready for approval', 'Complete the implementation package before requesting owner approval.'));
      content.append(action('Prepare implementation package', () => { activeStep = 'package'; render(); }, { class: 'design-primary' }));
      return;
    }
    if (approvedPackage()) {
      const approved = response.history?.find(item => item.id === current.id && item.version === current.version);
      content.append(node('div', '', { class: 'design-handoff-approval-card' }));
      const card = content.lastElementChild;
      card.append(badge('approved'), node('h4', approved?.title || draft.title), paragraph(`Version ${current.version} was approved${approved?.approval?.actorId ? ` by ${approved.approval.actorId}` : ''}${approved?.approval?.approvedAt ? ` on ${new Date(approved.approval.approvedAt).toLocaleString()}` : ''}.`));
      content.append(action('Continue to Plan', () => { activeStep = 'plan'; render(); }, { class: 'design-primary' }));
      const details = node('details'); details.append(node('summary', 'Revoke this approval'));
      const reason = node('textarea', '', { 'aria-label': 'Revocation reason', maxlength: '16384', placeholder: 'Why is this package no longer approved?' });
      details.append(reason, action('Revoke approval', () => {
        if (!reason.value.trim()) { reason.setCustomValidity('Enter a revocation reason.'); reason.reportValidity(); return; }
        reason.setCustomValidity('');
        void perform('Revoking approval…', async () => bridge.updateImplementationHandoff({ action: 'revoke', requestId: requestId('revoke'), expectedVersion: current.version, expectedContentDigest: current.contentDigest, reason: reason.value.trim() }), 'Approval revoked.');
      }, { class: 'design-danger' }));
      content.append(details);
      return;
    }
    if (!preview?.available) {
      content.append(empty(current?.status === 'revoked' ? 'The current approval was revoked' : 'This package cannot be approved yet', 'Refresh the package against the current ready design, then review approval again.'));
      content.append(action('Review implementation package', () => { activeStep = 'package'; render(); }, { class: 'design-primary' }));
      return;
    }
    const card = node('div', '', { class: 'design-handoff-approval-card' });
    card.append(node('h4', preview.summary.title), paragraph(`Version ${preview.summary.packageVersion} · ${preview.summary.requirementCount} requirements · direction ${preview.summary.selectedVariant}`), paragraph(preview.summary.description, 'design-muted'));
    content.append(card, action('Approve exact package', () => perform('Recording owner approval…', async () => {
      await bridge.updateImplementationHandoff({ action: 'approve', requestId: requestId('approve'), ...preview.approvalRequest });
    }, 'Implementation package approved.'), { class: 'design-primary' }));
  }

  async function copyText(value, output) {
    try { await navigator.clipboard.writeText(value); output.textContent = 'Invocation copied. Paste it into your active coding agent when you are ready.'; }
    catch {
      const field = node('textarea', '', { readonly: '', 'aria-label': 'Plan invocation' }); field.value = value; output.before(field); field.focus(); field.select(); output.textContent = 'Copy the selected invocation.';
    }
  }

  function renderPlan(content) {
    content.append(sectionTitle('Step 5 of 5', 'Continue to Plan', 'Prepare an explicit host handoff. Plan remains a separate action; Ship is never started here.'));
    if (!approvedPackage()) {
      content.append(empty('An approved current package is required', currentPackage()?.status === 'revoked' ? 'This package was revoked. Prepare and approve a current version before planning.' : 'Complete owner approval before preparing the Plan invocation.'));
      content.append(action('Review owner approval', () => { activeStep = 'approval'; render(); }, { class: 'design-primary' }));
      return;
    }
    const context = bridge.context();
    const subject = node('input', '', { type: 'text', required: '', maxlength: '256', value: context.designId, 'aria-label': 'Plan subject' });
    const label = node('label', 'Plan subject'); label.append(subject); content.append(label);
    const result = node('div', '', { class: 'design-handoff-plan-result', 'aria-live': 'polite' });
    content.append(action('Prepare Plan handoff', async () => {
      setBusy(true); setStatus('Preparing the Plan handoff…');
      try {
        const response = await bridge.updateImplementationHandoff({ action: 'continue-to-plan', subject: subject.value.trim() });
        const handoff = response.handoff;
        if (typeof bridge.continueToActiveHost === 'function') {
          await bridge.continueToActiveHost(handoff);
          result.textContent = 'The approved package was handed to the active host. Invoke Plan there to continue.';
        } else {
          const host = String(context.host || '').toLowerCase();
          const key = host.includes('claude') ? 'claudeCode' : host.includes('codex') ? 'codex' : host.includes('cursor') ? 'cursor' : 'fallback';
          const invocation = handoff.invocations[key] || handoff.invocations.fallback;
          result.replaceChildren(node('code', invocation));
          result.append(action('Copy invocation', () => void copyText(invocation, result), { class: 'design-handoff-copy' }));
        }
        setStatus('Plan handoff prepared. No planning files, agents, Git state or Ship run were changed.');
      } catch (error) { setStatus(error?.message || 'The Plan handoff could not be prepared.', true); }
      finally { setBusy(false); }
    }, { class: 'design-primary' }), result);
  }

  function render() {
    if (!panel) return;
    renderProgress();
    const content = q('[data-design-handoff-content]', panel); content.replaceChildren();
    ({ readiness: renderReadiness, review: renderReview, package: renderPackage, approval: renderApproval, plan: renderPlan })[activeStep](content);
  }

  async function refresh() {
    const attempt = ++serial;
    setBusy(true); setStatus('Refreshing handoff state…');
    const results = await Promise.allSettled([bridge.loadReadiness(), bridge.loadReviewHandoff(), bridge.loadImplementationHandoff()]);
    if (attempt !== serial || !panel) return;
    for (const [index, key] of ['readiness', 'review', 'implementation'].entries()) {
      const result = results[index];
      if (result.status === 'fulfilled') { state[key] = result.value; delete state.errors[key]; }
      else state.errors[key] = result.reason?.message || 'This state is temporarily unavailable.';
    }
    setBusy(false); setStatus(Object.keys(state.errors).length ? 'Some handoff state is unavailable. The current design remains usable.' : 'Handoff state is current.', Boolean(Object.keys(state.errors).length));
    render();
  }

  function close() {
    if (!panel) return;
    const returnTo = opener; panel.remove(); panel = null; delete root.dataset.designHandoffOpen;
    returnTo?.isConnected && returnTo.focus({ preventScroll: true });
  }

  function open(step = activeStep) {
    if (!bridge.owner()) return bridge.announce('Only a design owner can prepare an implementation handoff.', true);
    activeStep = steps.some(([id]) => id === step) ? step : 'readiness';
    if (panel) { render(); q(`[data-handoff-step="${activeStep}"]`, panel)?.focus(); return; }
    opener = document.activeElement; root.dataset.designHandoffOpen = 'true';
    panel = node('aside', '', { class: 'design-handoff-center', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'design-handoff-center-title' });
    const header = node('header');
    const heading = node('div'); heading.append(node('span', 'Owner workspace', { class: 'design-handoff-eyebrow' }), node('h2', 'Handoff Center', { id: 'design-handoff-center-title' }));
    header.append(heading, action('×', close, { 'aria-label': 'Close Handoff Center', class: 'design-handoff-close' }));
    const progress = node('nav', '', { class: 'design-handoff-progress', 'data-design-handoff-progress': '', 'aria-label': 'Design handoff progress' });
    const content = node('section', '', { class: 'design-handoff-content', 'data-design-handoff-content': '', tabindex: '-1' });
    const footer = node('footer'); footer.append(node('p', '', { 'data-design-handoff-status': '', role: 'status', 'aria-live': 'polite' }), action('Refresh', refresh, { 'data-design-handoff-refresh': '' }));
    panel.append(header, progress, content, footer); root.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    render(); q(`[data-handoff-step="${activeStep}"]`, panel)?.focus({ preventScroll: true }); void refresh();
  }

  function mount() {
    bridge = window.__openPlanrDesignHandoffBridge;
    root = q('.planr-shell');
    if (!bridge || !root) return false;
    window.__openPlanrDesignHandoffCenter = Object.freeze({ open, close, refresh, getState: () => ({ open: Boolean(panel), step: activeStep, statuses: Object.fromEntries(steps.map(([id]) => [id, statusFor(id)])) }) });
    return true;
  }
  const started = Date.now();
  function boot() { if (!mount() && Date.now() - started < 15000) setTimeout(boot, 30); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
