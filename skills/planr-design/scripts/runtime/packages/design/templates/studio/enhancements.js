/* Review experience. Trusted shell UI only; authored screens remain opaque sandboxes.
 * Adapter hooks: loadExperience, listRevisions, loadRevision, prepareComparisonSource,
 * loadHandoff, updateHandoff, updateReviewMetadata. All hooks are optional and fail visibly.
 */
(() => {
  'use strict';
  // A removed, still-downloading runtime belongs to a canceled opening.
  if (document.currentScript && !document.currentScript.isConnected) return;
  const payloadNode = document.getElementById('planr-design-studio-payload');
  if (!payloadNode) return;
  const payload = JSON.parse(payloadNode.textContent);
  const design = payload.document;
  const q = (selector, parent = document) => parent.querySelector(selector);
  const qa = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const node = (tag, text = '', attrs = {}) => {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    for (const [key, entry] of Object.entries(attrs)) if (entry !== undefined && entry !== null && entry !== false) value.setAttribute(key, entry);
    return value;
  };
  const button = (text, action, attrs = {}) => { const value = node('button', text, { type: 'button', ...attrs }); value.addEventListener('click', action); return value; };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const options = () => globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ || {};
  const scope = `openplanr.experience.${location.pathname.startsWith('/d/') ? location.pathname : design.id}`;
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`${scope}.${key}`)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(`${scope}.${key}`, JSON.stringify(value)); } catch { /* Personal preferences remain usable in memory. */ } };
  const avatarColors = [
    ['teal', 'Teal', '#0f766e'], ['blue', 'Blue', '#1d4ed8'], ['violet', 'Violet', '#6d28d9'],
    ['rose', 'Rose', '#be185d'], ['amber', 'Amber', '#a16207'], ['slate', 'Slate', '#475569'],
  ];
  const colorFor = value => [...String(value)].reduce((n, char) => (n * 31 + char.codePointAt(0)) >>> 0, 0) % avatarColors.length;
  const normalizedProfile = value => ({ name: typeof value?.name === 'string' ? value.name.trim().slice(0, 160) : '', color: avatarColors.some(([key]) => key === value?.color) ? value.color : avatarColors[colorFor(value?.name || '')][0] });
  let profile = normalizedProfile(read('profile', null)), themePreference = 'dark';
  try { const saved = localStorage.getItem('openplanr.design.theme'); if (['dark', 'light', 'system'].includes(saved)) themePreference = saved; } catch {}
  const systemTheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  const applyTheme = () => {
    const resolved = themePreference === 'system' ? (systemTheme?.matches ? 'light' : 'dark') : themePreference;
    if (stage?.getState().theme !== resolved) stage?.dispatch({ type:'set-theme',theme:resolved });
    Object.assign(document.documentElement.dataset, { planrTheme: resolved, designTheme: resolved, designThemePreference: themePreference });
    for (const value of qa('[data-design-theme-choice]')) value.value = themePreference;
    options().onThemeChange?.({ preference: themePreference, resolved });
  };
  const setTheme = value => {
    if (!['dark', 'light', 'system'].includes(value)) return;
    themePreference = value; try { localStorage.setItem('openplanr.design.theme', value); } catch {}
    applyTheme();
  };
  const select = (label, values, initial) => {
    const value = node('select', '', { 'aria-label': label });
    for (const [id, text] of values) value.append(node('option', text, { value: id }));
    value.value = initial; return value;
  };
  let studio, stage, root, rail, experience, activeDialog, railTab = 'review', inspectorEnabled = false;
  let metadata = { version: 0, categories: {}, dispositions: {} };
  let destroyers = [], disposed = false;
  const on = (target, name, callback, config) => { target.addEventListener(name, callback, config); destroyers.push(() => target.removeEventListener(name, callback, config)); };
  const revision = () => experience?.revision || studio.getRevision() || payload.revision;
  const reviewerAudience = () => options().audience === 'reviewer' || location.pathname.startsWith('/d/');
  const commentTypes = [['question','Question','Ask for clarification'], ['suggestion','Suggestion','Offer an optional improvement'], ['change-request','Request change','Ask for a specific change'], ['blocker','Blocker','Must be addressed before proceeding']];
  const categoryLabel = value => commentTypes.find(([id]) => id === value)?.[1] || ({ fix:'Fix', improve:'Improve' })[value] || value;
  const owner = () => experience?.capabilities?.owner === true || experience?.owner === true;
  const state = () => studio.getState();
  const entry = (screenId = state().screenId) => payload.entries.find(item => item.screenId === screenId && item.variantId === state().variantId && item.frameId === state().frameId);
  const pinScope = pin => { const reviewId = pin.reviewId || stage.review.getState().review?.reviewId; const revisionId = pin.revisionId || (reviewId?.startsWith('shared-') ? reviewId.slice(7) : undefined); return { ...(reviewId ? {reviewId}:{}), ...(revisionId ? {revisionId}:{}) }; };
  const pinMetadata = pin => { const value = pinScope(pin); return metadata.byRevision?.[value.revisionId || value.reviewId] || metadata; };
  let toastTimer;
  function announce(text, error = false) {
    let value = q('[data-experience-status]');
    if (!value) { value = node('div', '', { class: 'design-experience-status', 'data-experience-status': '', role: 'status', 'aria-live': 'polite' }); root.append(value); }
    value.textContent = text; value.dataset.error = String(error); value.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { value.hidden = true; }, error ? 12000 : 6500);
  }
  async function request(name, urlName, input) {
    if (typeof options()[name] === 'function') return options()[name](input);
    const url = options()[urlName];
    if (!url) throw new Error('This action is unavailable in this viewer. Open the attached local review to continue.');
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...(input === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-openplanr-design': '1' }, body: JSON.stringify(input) }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || 'The request could not be saved. Retry after reconnecting.');
    return result;
  }
  function modal(title, className = '', onDismiss) {
    activeDialog?.dismiss?.();
    const opener = document.activeElement;
    if (q('[data-design-notes]')?.open) q('[data-design-close-notes]')?.click();
    const dialog = node('dialog', '', { class: `design-experience-dialog ${className}`, 'aria-label': title });
    const head = node('header'); head.append(node('h2', title));
    const dismiss = () => { if (!disposed) onDismiss?.(); dialog.close(); dialog.remove(); if (activeDialog === dialog) activeDialog = null; opener?.isConnected && opener.focus({ preventScroll:true }); };
    dialog.dismiss = dismiss;
    head.append(button('×', dismiss, { 'aria-label': `Close ${title.toLowerCase()}`, class: 'design-dialog-close' }));
    const content = node('div', '', { class: 'design-dialog-content' }); dialog.append(head, content);
    const status = node('p', '', { role: 'status', 'aria-live': 'polite', class: 'design-dialog-status' }); dialog.append(status);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('keydown', event => { event.stopPropagation(); });
    dialog.addEventListener('click', event => { const r = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dismiss(); });
    document.body.append(dialog); activeDialog = dialog; dialog.showModal();
    return { dialog, content, status, dismiss };
  }
  function about(auto = false) {
    if (auto && (read('welcomed', false) || !location.pathname.startsWith('/d/'))) return;
    const dialog = modal('Welcome to this review', 'design-welcome', () => write('welcomed', true));
    const { content, dismiss } = dialog;
    dialog.dialog.dataset.designWelcomeStep = 'intro';
    const intro = node('div');
    content.append(node('div', 'OpenPlanr · Design review', { class: 'design-eyebrow' }), node('h3', design.title));
    const brief = experience?.reviewContext?.brief || payload.reviewContext?.brief;
    content.append(node('p', brief?.purpose || 'Explore this design and leave feedback on the screens that matter to you.'));
    if (brief?.audience) content.append(node('p', `For ${brief.audience}`, { class: 'design-muted' }));
    if (brief?.requests?.length) { content.append(node('h4', 'What we need your feedback on')); const list = node('ul'); for (const text of brief.requests) list.append(node('li', text)); content.append(list); }
    content.append(node('p', 'Use Review to add a comment. Your navigation and canvas arrangement are personal.', { class: 'design-muted' }));
    const start = (view) => { dismiss(); studio.setView(view); if (view === 'walkthrough') studio.selectScreen(design.screenOrder[0]); studio.setPanels({ navOpen: false, reviewOpen: false }); studio.fit(); };
    const actions = node('div', '', { class: 'design-dialog-actions' });
    const next = view => {
      while (content.firstChild) intro.append(content.firstChild);
      renderProfile(dialog, { continueAction: () => start(view), back: () => { content.replaceChildren(...intro.childNodes); dialog.dialog.dataset.designWelcomeStep = 'intro'; dialog.dialog.setAttribute('aria-label','Welcome to this review'); q('h2',dialog.dialog).textContent = 'Welcome to this review'; actions.querySelector('button')?.focus(); } });
    };
    actions.append(button('Start walkthrough', () => next('walkthrough'), { class: 'design-primary' }), button('Explore freely', () => next('canvas'))); content.append(actions);
  }
  function avatar(author, { color, large = false } = {}) {
    const name = author?.name || 'Reviewer';
    const identity = stage?.review.getState().identity;
    const own = typeof options().isOwnReviewAuthor === 'function' ? options().isOwnReviewAuthor(author) : author?.id && identity?.id ? author.id === identity.id : !author?.id && !identity?.id && name === identity?.name;
    const key = color || (own ? profile.color : avatarColors[colorFor(author?.id || name)][0]);
    const chosen = avatarColors.find(([id]) => id === key) || avatarColors[0];
    const initials = name.trim().split(/\s+/u).slice(0,2).map(part => [...part][0] || '').join('').toLocaleUpperCase();
    const value = node('span', initials || 'R', { class: `design-avatar${large ? ' design-avatar-large' : ''}`, 'aria-hidden': 'true', 'data-avatar-color': chosen[0] });
    value.style.setProperty('--design-avatar-color', chosen[2]); return value;
  }
  function themeChoice() {
    const wrapper = node('label', 'Appearance', { class: 'design-theme-field' });
    const choice = select('Studio theme', [['dark','Dark'],['light','Light'],['system','System']], themePreference);
    choice.title = 'Board appearance only. Product screens keep their own theme.';
    choice.setAttribute('aria-description', choice.title);
    choice.dataset.designThemeChoice = ''; choice.addEventListener('change', () => setTheme(choice.value)); wrapper.append(choice); return wrapper;
  }
  let notifiedProfile;
  function profileChanged() {
    for (const value of qa('[data-design-profile-button]')) {
      value.replaceChildren(avatar(profile, { color: profile.color }), node('span', profile.name || 'Reviewer profile'));
      value.title = profile.name ? `Edit profile for ${profile.name}` : 'Set up your reviewer profile';
    }
    const identityBlock=q('.planr-identity'); if (identityBlock && reviewerAudience()) identityBlock.hidden=Boolean(profile.name);
    const next = JSON.stringify(profile);
    if (profile.name && next !== notifiedProfile) { notifiedProfile = next; options().onProfileChange?.({ ...profile }); }
    updateFilters();
  }
  function saveProfile(next) {
    profile = normalizedProfile(next); write('profile', profile);
    const identity = stage.review.getState().identity;
    stage.review.setIdentity({ ...(identity?.id ? { id: identity.id } : {}), name: profile.name });
    profileChanged();
  }
  function renderProfile(dialog, { continueAction = dialog.dismiss, back } = {}) {
    const { content, status } = dialog;
    dialog.dialog.dataset.designWelcomeStep = 'profile'; dialog.dialog.setAttribute('aria-label','Your reviewer profile'); q('h2',dialog.dialog).textContent = 'Your reviewer profile';
    content.replaceChildren();
    content.append(node('p', 'Choose how your comments appear. You can change this later.', { class: 'design-muted' }));
    const form = node('form', '', { class: 'design-profile-form' });
    const preview = node('div', '', { class: 'design-profile-preview' });
    const draft = { ...profile };
    const refresh = () => { preview.replaceChildren(avatar(draft, { color: draft.color, large: true }), node('strong', draft.name.trim() || 'Your name')); };
    const label = node('label', 'Reviewer name');
    const name = node('input', '', { type: 'text', name: 'reviewer-name', autocomplete: 'nickname', enterkeyhint:'done', maxlength: '160', required: '', 'aria-label': 'Reviewer name', placeholder: 'How should the team know you?' });
    name.value = draft.name; name.addEventListener('input', () => { draft.name = name.value; name.setCustomValidity(''); refresh(); }); label.append(name);
    const palette = node('fieldset', '', { class: 'design-avatar-palette' }); palette.append(node('legend', 'Avatar color'));
    for (const [key, title, color] of avatarColors) {
      const option = node('label', '', { class: 'design-avatar-option' });
      const radio = node('input', '', { type: 'radio', name: 'avatar-color', value: key, 'aria-label': title }); radio.checked = draft.color === key;
      const swatch = node('span', '', { 'aria-hidden': 'true' }); swatch.style.setProperty('--design-avatar-color',color);
      radio.addEventListener('change', () => { if (radio.checked) { draft.color = key; refresh(); } });
      option.append(radio,swatch,node('span',title)); palette.append(option);
    }
    form.append(preview,label,palette,node('p','Your name is shared with comments. Your avatar color is a personal preference saved in this browser.',{class:'design-muted'}),themeChoice());
    const actions = node('div', '', { class: 'design-dialog-actions' });
    const submit = node('button', back ? 'Continue to review' : 'Save profile', { type:'submit',class:'design-primary' });
    actions.append(submit);
    if (back) actions.append(button('Browse first', continueAction),button('Back',back));
    else actions.append(button('Cancel',dialog.dismiss));
    form.append(actions);content.append(form);refresh();
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!draft.name.trim()) { name.setCustomValidity('Enter a name, or choose Browse first.'); name.reportValidity(); return; }
      try { saveProfile(draft); continueAction(); } catch (error) { status.textContent = error.message; }
    });
    // Opening the profile step must not also open a phone keyboard and move
    // the page. The person chooses when to type; desktop retains direct focus.
    if (window.matchMedia?.('(pointer:coarse), (max-width:680px)').matches) {
      const title = q('h2',dialog.dialog); title.tabIndex = -1; title.focus({ preventScroll:true });
    } else name.focus({ preventScroll:true });
    content.scrollTop = 0;
  }
  function editProfile() { renderProfile(modal('Your reviewer profile', 'design-profile')); }
  function installMobileViewport() {
    const html = document.documentElement;
    const mobile = window.matchMedia?.('(pointer:coarse), (max-width:680px)');
    if (!mobile) return;
    let pending = 0, width = innerWidth;
    const clear = () => {
      delete root.dataset.designKeyboard;
      root.style.removeProperty('--design-frozen-shell-height');
      html.style.removeProperty('--design-visible-height');
      html.style.removeProperty('--design-visible-top');
    };
    const update = () => {
      pending = 0;
      const active = document.activeElement;
      const editing = mobile.matches && active?.matches('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]),textarea,select');
      if (!editing) { clear(); return; }
      if (!root.dataset.designKeyboard || width !== innerWidth) {
        root.style.removeProperty('--design-frozen-shell-height');
        root.style.setProperty('--design-frozen-shell-height',`${root.getBoundingClientRect().height}px`);
        root.dataset.designKeyboard = 'true'; width = innerWidth;
      }
      const visual = window.visualViewport;
      // Browser pinch zoom remains native. Never resize/reposition the layout
      // to counteract a person's zoom, which would create a scale feedback loop.
      if (visual && Math.abs(visual.scale - 1) < .01) {
        html.style.setProperty('--design-visible-height',`${Math.max(1,visual.height)}px`);
        html.style.setProperty('--design-visible-top',`${Math.max(0,visual.offsetTop)}px`);
      }
    };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(update); };
    on(document,'focusin',update); on(document,'focusout',schedule);
    on(window,'resize',schedule);
    if (window.visualViewport) { on(window.visualViewport,'resize',schedule); on(window.visualViewport,'scroll',schedule); }
    destroyers.push(() => { cancelAnimationFrame(pending); clear(); });
  }
  function installProfileAndTheme() {
    applyTheme();
    if (systemTheme?.addEventListener) on(systemTheme,'change',() => { if (themePreference === 'system') applyTheme(); });
    const identity = stage.review.getState().identity;
    if (identity?.name) profile = normalizedProfile({ ...profile,name:identity.name });
    else if (profile.name) stage.review.setIdentity({ name:profile.name });
    const footer = node('div','',{class:'design-personal-settings'});
    footer.append(button('',editProfile,{'data-design-profile-button':'','aria-label':'Edit reviewer profile',class:'design-profile-button'}),themeChoice());
    q('.design-nav-footer').before(footer);
    destroyers.push(stage.review.controller.subscribe((state, change) => {
      if (change.type !== 'identity') return;
      profile = normalizedProfile({ ...profile,name:state.identity?.name || '' }); write('profile',profile); profileChanged();
    }));
    profileChanged();
  }
  function installPersonalDrafts() {
    // Shared reviews already persist drafts through their authenticated host.
    if (location.pathname.startsWith('/d/')) return;
    const key = `review-drafts.${payload.revision || studio.getRevision() || 'unpublished'}`;
    const restore = () => { const saved = read(key,null); if (saved) { try { stage.review.restoreDrafts?.(saved); } catch { /* Invalid personal storage must not block the studio. */ } } };
    restore(); on(root,'planr:design-ready',restore,{once:true});
    on(root,'planr:artifact-review-draft-change',event => { if (event.detail?.reviewOf) write(key,event.detail); });
    on(window,'pagehide',() => { const snapshot = stage.review.snapshotDrafts?.(); if (snapshot?.reviewOf) write(key,snapshot); });
  }
  function installReadability() {
    const widths = read('widths', { left: 240, right: 336 });
    const apply = () => { root.style.setProperty('--design-nav-width', `${clamp(widths.left, 200, 360)}px`); root.style.setProperty('--planr-review-rail-width', `${clamp(widths.right, 300, 480)}px`); };
    apply();
    for (const [side, panel, min, max] of [['left', q('.design-navigator'), 200, 360], ['right', rail, 300, 480]]) {
      const handle = node('div', '', { class: `design-resize-handle design-resize-${side}`, role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': `Resize ${side === 'left' ? 'screens' : 'review'} sidebar`, 'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuenow': String(widths[side]) });
      panel.append(handle);
      const set = value => { widths[side] = clamp(value, min, max); apply(); handle.setAttribute('aria-valuenow', String(Math.round(widths[side]))); write('widths', widths); };
      let drag;
      on(handle, 'pointerdown', event => { if (event.button !== 0) return; drag = { start: event.clientX, width: widths[side], id: event.pointerId }; handle.setPointerCapture(event.pointerId); event.preventDefault(); root.dataset.designResizing = 'true'; });
      on(handle, 'pointermove', event => { if (drag?.id === event.pointerId) set(drag.width + (event.clientX - drag.start) * (side === 'left' ? 1 : -1)); });
      for (const name of ['pointerup', 'pointercancel']) on(handle, name, () => { drag = null; delete root.dataset.designResizing; });
      on(handle, 'keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * (event.shiftKey ? 40 : 8); set(event.key === 'Home' ? min : event.key === 'End' ? max : widths[side] + delta); });
      on(handle, 'dblclick', () => set(side === 'left' ? 240 : 336));
    }
  }
  function installThumbnails() {
    // Phones use numbered navigation: styled DOM/SVG captures can briefly
    // multiply the memory occupied by a live product document.
    if (stage.frameBudget) return;
    const cache = new Map(), queue = [], queued = new Set(); let running = false, ready = false;
    const paintable = current => {
      const frame = stage.getFrame(current.artifactId);
      return state().navOpen && frame && !frame.closest('.planr-artifact-panel')?.hidden && frame.getClientRects().length > 0;
    };
    const renderThumb = async (screenButton) => {
      const current = entry(screenButton.dataset.designScreen); if (!current) return;
      const fingerprint = (experience?.fingerprints || payload.fingerprints)?.find(item => item.screenId === current.screenId && item.frameId === current.frameId && item.variantId === current.variantId);
      const key = `${fingerprint?.contentDigest || revision()}:${current.artifactId}`; const target = q('.design-thumbnail', screenButton);
      if (cache.has(key)) { target.replaceChildren(cache.get(key).cloneNode()); return; }
      if (!paintable(current)) return;
      if (queued.has(key)) return; queued.add(key); queue.push({ current, key, target }); await pump();
    };
    const pump = async () => {
      if (running || !ready || disposed) return; running = true;
      while (queue.length && !disposed) {
        const { current, key, target } = queue.shift();
        try {
          if (!paintable(current)) continue;
          const result = await stage.getFrame(current.artifactId)?.__openPlanrBridge?.thumbnail?.();
          if (typeof result?.dataUrl !== 'string' || !/^data:image\/png;base64,/u.test(result.dataUrl) || result.dataUrl.length > 360000) continue;
          const img = node('img', '', { src: result.dataUrl, alt: '', loading: 'lazy' }); cache.set(key, img);
          if (entry(current.screenId)?.artifactId === current.artifactId) target.replaceChildren(img.cloneNode());
        } catch { /* The labelled screen button remains usable when capture is unavailable. */ }
        finally { queued.delete(key); }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      running = false;
    };
    const screenButtons = qa('[data-design-screen]');
    for (const screenButton of screenButtons) {
      const preview = node('span', '', { class: 'design-thumbnail', 'aria-hidden': 'true' }); preview.append(node('span', screenButton.querySelector('.design-screen-number')?.textContent || '')); screenButton.prepend(preview);
    }
    const visible = new Set();
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(records => { for (const record of records) { if (record.isIntersecting) { visible.add(record.target); void renderThumb(record.target); } else visible.delete(record.target); } }, { root: q('.design-screen-list'), rootMargin: '120px' }) : null;
    if (observer) { screenButtons.forEach(item => observer.observe(item)); destroyers.push(() => observer.disconnect()); }
    else screenButtons.slice(0, 6).forEach(item => visible.add(item));
    let signature = '', scheduled;
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = requestAnimationFrame(() => { scheduled = null; for (const target of visible) void renderThumb(target); void pump(); });
    };
    // Journey views hide inactive frames. Retry only when a presentation change can
    // make a frame paintable, after layout; camera motion never creates retry loops.
    on(root, 'planr:design-render', () => { const current = state(); const next = `${current.view}:${current.screenId}:${current.variantId}:${current.frameId}:${current.navOpen}`; if (next !== signature) { signature = next; schedule(); } });
    destroyers.push(() => cancelAnimationFrame(scheduled));
    const start = () => { ready = true; schedule(); };
    on(root, 'planr:design-ready', start); if (stage.getState().status === 'ready') setTimeout(start, 200);
  }
  let updateFilters = () => {};
  function categoryPicker(initial, onChange) {
    const group = node('div','',{class:'design-category-picker',role:'radiogroup','aria-label':'Comment type'});
    const field = node('input','',{type:'hidden','data-planr-draft-key':'category'}); field.value=initial; group.append(field);
    const sync = () => {
      for (const value of qa('[role="radio"]',group)) { const selected=value.dataset.designCategory===field.value; value.setAttribute('aria-checked',String(selected)); value.tabIndex=selected || (!commentTypes.some(([id])=>id===field.value) && value===q('[role="radio"]',group)) ? 0 : -1; }
      onChange?.(field.value);
    };
    for (const [id,label,hint] of commentTypes) {
      const choice=button(label,()=>{field.value=id;field.dispatchEvent(new Event('change',{bubbles:true}));},{role:'radio','aria-label':label,'data-design-category':id,title:hint,'aria-description':hint}); group.append(choice);
    }
    group.addEventListener('keydown',event=>{if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;event.preventDefault();const buttons=qa('[role="radio"]',group),index=buttons.indexOf(event.target);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
    field.addEventListener('change',sync); sync(); return {group,field};
  }
  function installComposerCategory() {
    let pending = null, saving = false, retry;
    const outbox = read(`categories.${revision()}`, {});
    const available = () => typeof options().updateReviewMetadata === 'function' || (owner() && (options().handoffUrl || options().updateHandoff));
    const flush = async () => {
      if (saving || !available()) return; saving = true;
      try {
        for (const [pinId, category] of Object.entries(outbox)) {
          const body = { action: 'category', pinId, category, revision: revision(), version: metadata.version || 0, ...pinScope({}) };
          const result = options().updateReviewMetadata ? await options().updateReviewMetadata(body) : await request('updateHandoff', 'handoffUrl', body);
          metadata = result.metadata || { ...metadata, categories: { ...metadata.categories, [pinId]: category } };
          delete outbox[pinId]; write(`categories.${revision()}`, outbox); updateFilters();
        }
      } catch { announce('Comment saved. Its type is waiting to sync. Retry when your connection is available.', true); }
      finally { saving = false; if (retry) retry.hidden = !Object.keys(outbox).length; }
    };
    on(root, 'planr:artifact-annotation-draft', () => {
      const composer = q('[data-planr-annotation-composer]'); if (!composer || q('[data-planr-draft-key="category"]', composer) || !available()) return;
      const picker = q('[role="radiogroup"]', composer); picker.hidden = true;
      const {group,field:category} = categoryPicker('suggestion', value => { const intent = { question:'question',suggestion:'improve','change-request':'fix',blocker:'fix' }[value] || 'improve'; q(`[data-planr-intent="${intent}"]`, picker).click(); });
      const label = node('div', '', { class: 'design-composer-category' }); label.append(node('span','Comment type'),group); picker.after(label);
      q('[data-planr-composer-comment]',composer).placeholder='Describe your feedback for this area…';
      composer.addEventListener('submit', () => { if (!q('[data-planr-composer-comment]', composer).value.trim() || !q('[data-planr-composer-identity]', composer).value.trim()) { pending = null; return; } pending = { ids: new Set((stage.review.getState().review?.pins || []).map(item => item.id)), category: category.value }; }, { capture: true });
    });
    on(root, 'planr:artifact-review-change', event => {
      if (pending) { const pin = event.detail?.pins?.find(item => !pending.ids.has(item.id)); if (pin) { outbox[pin.id] = pending.category; metadata.categories = { ...metadata.categories, [pin.id]: pending.category }; write(`categories.${revision()}`, outbox); pending = null; queueMicrotask(() => { updateFilters(); void flush(); }); } }
    });
    on(window, 'online', flush);
    on(document, 'openplanr:design-experience-changed', flush);
    retry = button('Retry pending categories', flush, { class: 'design-text-button' });
    retry.hidden = !Object.keys(outbox).length; q('[data-design-review-filters]').append(retry);
    on(root, 'planr:artifact-review-change', () => { retry.hidden = !Object.keys(outbox).length; });
  }
  function installReview() {
    const controls = node('div', '', { class: 'design-review-filters', 'data-design-review-filters': '' });
    const row = node('div', '', { class: 'design-filter-row' });
    const scopeFilter = select('Review scope', [['screen', 'This screen'], ['all', 'All screens']], 'screen');
    const statusFilter = select('Review status', [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All statuses']], 'open');
    row.append(scopeFilter, statusFilter);
    const search = node('input', '', { type: 'search', placeholder: 'Search comments', 'aria-label': 'Search comments' });
    const type = select('Comment type', [['all', 'All types'], ['question', 'Questions'], ['suggestion', 'Suggestions'], ['change-request','Change requests'], ['blocker', 'Blockers'], ['fix', 'Fixes']], 'all');
    const unreadOnly = node('input', '', { type: 'checkbox' }); const unreadLabel = node('label', '', { class: 'design-unread-toggle' }); const unreadCount = node('span', 'Unread only'); unreadLabel.append(unreadOnly, unreadCount);
    const secondary = node('div', '', { class: 'design-filter-row' }); secondary.append(type, unreadLabel);
    controls.append(row, search, secondary, button('Export reviews', exportReviews, {class:'design-review-export'})); q('.design-comment-action').after(controls);
    const seen = read(`seen.${revision()}`, {});
    const activity = pin => [pin.updatedAt, pin.createdAt, ...(pin.replies || []).map(reply => reply.createdAt)].filter(Boolean).sort().at(-1) || '';
    const unread = pin => (seen[pin.id] || '') < activity(pin);
    const category = pin => pinMetadata(pin).categories?.[pin.id] || (pin.intent === 'improve' ? 'suggestion' : pin.intent);
    const filter = pin => {
      const identity = payload.entries.find(value => value.artifactId === pin.artifactId);
      const screenId = pin.anchor?.screen || identity?.screenId;
      return (scopeFilter.value === 'all' || screenId === state().screenId) && (statusFilter.value === 'all' || (statusFilter.value === 'resolved' ? pin.status === 'resolved' : pin.status !== 'resolved')) && (type.value === 'all' || category(pin) === type.value) && (!unreadOnly.checked || unread(pin)) && (!search.value.trim() || [pin.comment, pin.author.name, ...(pin.replies || []).flatMap(reply => [reply.comment, reply.author.name])].join(' ').toLowerCase().includes(search.value.trim().toLowerCase()));
    };
    const label = pin => categoryLabel(category(pin));
    const decorate = ({ element, pin }) => {
      q('.planr-review-byline',element)?.prepend(avatar(pin.author));
      qa('.planr-reply',element).forEach(reply => { const author=pin.replies?.find(item => item.id === reply.dataset.planrReplyId)?.author; if(author) q('header',reply).prepend(avatar(author)); });
      element.dataset.designCategory=category(pin);
      const badge=q('.planr-intent',element); badge.dataset.designCategory=category(pin);
      const section = node('div', '', { class: 'design-thread-triage' });
      const canCategorize = (typeof options().updateReviewMetadata === 'function' || (owner() && (options().handoffUrl || options().updateHandoff))) && (typeof options().canCategorizePin !== 'function' || options().canCategorizePin(pin.id));
      if (canCategorize) {
        const edit=button(label(pin), async () => {
          const {content,status,dismiss}=modal('Comment type');
          content.append(node('p',pin.comment,{class:'design-edit-comment-excerpt'}));
          let save;
          const {group,field}=categoryPicker(category(pin),()=>{if(save)save.disabled=false;});content.append(group);
          save=button('Save type',async()=>{save.disabled=true;try {
            const body={action:'category',pinId:pin.id,category:field.value,revision:revision(),version:metadata.version||0,...pinScope(pin)};
            const result=options().updateReviewMetadata?await options().updateReviewMetadata(body):await request('updateHandoff','handoffUrl',body);
            metadata=result.metadata||{...metadata,categories:{...metadata.categories,[pin.id]:field.value}};updateFilters();dismiss();
          }catch(error){status.textContent=error.message;}finally{save.disabled=false;}},{class:'design-primary'});
          save.disabled=!commentTypes.some(([id])=>id===field.value);
          const actions=node('div','',{class:'design-dialog-actions'});actions.append(button('Cancel',dismiss),save);content.append(actions);
        },{class:'design-category-badge','data-design-category':category(pin),'aria-label':`Change comment type: ${label(pin)}`,title:'Change comment type'});
        badge.replaceWith(edit);
      }
      const disposition = pinMetadata(pin).dispositions?.[pin.id];
      if (disposition) section.append(node('span', `${disposition.disposition}${disposition.reason ? ` · ${disposition.reason}` : ''}`, { class: 'design-disposition' }));
      if (owner()) section.append(button('Disposition', () => editDisposition(pin), { class: 'design-small-button' }));
      if (section.childNodes.length) element.append(section);
    };
    const colorPins = () => { if(disposed)return; const colors=new Map((stage.review.getState().review?.pins || []).map(pin=>[pin.id,category(pin)])); for(const marker of qa('[data-planr-pin-id]')) { const value=colors.get(marker.dataset.planrPinId);if(value && marker.dataset.designCategory!==value) marker.dataset.designCategory=value; } };
    const updateUnread = () => { const count = (stage.review.getState().review?.pins || []).filter(unread).length; unreadCount.textContent = `Unread · ${count}`; };
    updateFilters = () => { if(disposed)return; updateUnread(); stage.review.setPresentation?.({ compact:true, pageSize:40, filterKey:JSON.stringify([scopeFilter.value,statusFilter.value,type.value,unreadOnly.checked,search.value,state().screenId]), filterPin: filter, describePin: pin => ({ intentLabel: label(pin), unread: unread(pin) }), decorateThread: decorate, emptyMessage: 'No comments match these filters.', onThreadOpen: (pinId) => { const pin = stage.review.getState().review?.pins.find(item => item.id === pinId); if (pin && unread(pin)) { seen[pinId] = activity(pin); write(`seen.${revision()}`, seen); const thread = qa('[data-planr-pin-id]').find(value => value.dataset.planrPinId === pinId); thread?.removeAttribute('data-planr-unread'); updateUnread(); } } }); colorPins(); };
    on(root, 'planr:artifact-review-change', () => { updateUnread(); queueMicrotask(colorPins); });
    for (const value of [scopeFilter, statusFilter, type, unreadOnly]) on(value, 'change', updateFilters);
    on(search, 'input', updateFilters);
    let currentScreen = state().screenId;
    on(root, 'planr:design-render', () => { if (currentScreen !== state().screenId) { currentScreen = state().screenId; updateFilters(); } });
    updateFilters(); colorPins();
    on(document,'planr:design-experience-change',()=>queueMicrotask(colorPins));
  }
  function exportReviews() {
    const {content,status,dialog}=modal('Export reviews');
    const canLoad=typeof options().loadReviewExport==='function';
    const scopeChoice=select('Review export scope', canLoad ? [['current','Current revision'],['all','All revisions']] : [['current','Current revision']], 'current');
    content.append(node('p','Download comments and replies with their original screen, frame, timestamps and pin coordinates. This does not approve or resolve feedback.'),scopeChoice);
    const actions=node('div','',{class:'design-dialog-actions'});
    let preparing=false;
    const download=async(format)=>{
      if(preparing)return;preparing=true;
      for(const value of actions.querySelectorAll('button'))value.disabled=true;
      scopeChoice.disabled=true;status.textContent='Preparing review history…';
      try {
        if(Object.keys(read(`categories.${revision()}`,{})).length)throw Error('A comment type is still waiting to save. Reconnect and retry after it finishes.');
        const tools=globalThis.OpenPlanrDesignReviewExport;
        if(!tools)throw Error('Review export is unavailable. Reload this review and try again.');
        if(canLoad && !reviewerAudience()){await studio.flush();if(studio.getSaveState().dirty)throw Error('Changes are still waiting to save. Reconnect and retry.');}
        const snapshot=canLoad?await options().loadReviewExport({scope:scopeChoice.value}):tools.createDesignReviewExport({bundle:{document:design,entries:payload.entries,revision:revision()},revisionId:revision(),review:stage.review.getState().review,metadata,historyComplete:!experience?.loadingHistory,olderPagesLoading:Boolean(experience?.loadingHistory),generatedAt:new Date().toISOString()});
        if(!dialog.isConnected)return;
        const text=tools.serializeDesignReviewExport(snapshot,format),url=URL.createObjectURL(new Blob([text],{type:format==='json'?'application/json':'text/markdown;charset=utf-8'}));
        const link=node('a','',{href:url,download:`design-review-${scopeChoice.value}.${format==='json'?'json':'md'}`});
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
        status.textContent=`Exported ${snapshot.summary.threads} comments and ${snapshot.summary.replies} replies.${snapshot.completeness.historyComplete?'':' Some history is unavailable; the export identifies this.'}`;
      }catch(error){status.textContent=`Could not export reviews: ${error.message} Try the download again.`;}
      finally{preparing=false;for(const value of actions.querySelectorAll('button'))value.disabled=false;scopeChoice.disabled=false;}
    };
    actions.append(button('Download Markdown',()=>void download('markdown'),{class:'design-primary'}),button('Download JSON',()=>void download('json')));content.append(actions);
  }
  async function editDisposition(pin) {
    const { content, status } = modal('Review disposition');
    const current = pinMetadata(pin).dispositions?.[pin.id];
    content.append(node('p', pin.comment));
    const value = select('Disposition', [['accepted', 'Accept for implementation'], ['deferred', 'Defer'], ['rejected', 'Decline']], current?.disposition || 'accepted');
    const reason = node('textarea', '', { 'aria-label': 'Disposition reason', placeholder: 'Explain the decision', maxlength: '8192' }); reason.value = current?.reason || '';
    const save = button('Save disposition', async () => {
      save.disabled = true;
      try { const result = await request('updateHandoff', 'handoffUrl', { action: 'disposition', revision: revision(), version: metadata.version || 0, pinId: pin.id, disposition: value.value, reason: reason.value.trim(), ...pinScope(pin) }); metadata = result.metadata || metadata; updateFilters(); status.textContent = 'Disposition saved. Original feedback is unchanged.'; }
      catch (error) { status.textContent = error.message; } finally { save.disabled = false; }
    }, { class: 'design-primary' }); content.append(value, reason, save);
  }
  function installCanvas() {
    const tools = q('.design-canvas-tools');
    const more = node('details', '', { class: 'design-tools-menu' }); more.append(node('summary', 'More', { 'aria-label': 'More canvas controls' }));
    const list = node('div');
    list.append(button('Fit selection', () => { studio.fitSelection(); more.open = false; }, { 'aria-keyshortcuts': 'Shift+2' }));
    let minimapOpen = read('minimap', design.screens.length > 6);
    const toggleMap = button('Minimap', () => { minimapOpen = !minimapOpen; write('minimap', minimapOpen); draw(); more.open = false; }, { 'aria-pressed': String(minimapOpen) }); list.append(toggleMap);
    const presentation = button('Present fullscreen', () => { void fullscreen(); more.open = false; }); list.append(presentation);
    list.append(button('Keyboard shortcuts', () => { shortcuts(); more.open = false; }, { 'aria-keyshortcuts': '?' }), button('Reviewer profile', () => { editProfile(); more.open = false; }), button('About this review', () => { about(); more.open = false; })); more.append(list); tools.append(more);
    const map = node('div', '', { class: 'design-minimap', 'aria-label': 'Canvas minimap' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 200 128'); svg.setAttribute('aria-label', 'Canvas overview');
    const close = button('×', () => { minimapOpen = false; write('minimap', false); draw(); }, { class: 'design-minimap-close', 'aria-label': 'Close minimap' }); map.append(svg, close); q('.planr-stage').append(map);
    const scroll = q('.planr-stage-scroll'); let geometry = null, scheduled = false;
    const mapBoards = new Map();
    const viewportRect = document.createElementNS(svg.namespaceURI, 'rect');
    viewportRect.setAttribute('class', 'design-minimap-viewport'); viewportRect.setAttribute('pointer-events', 'none'); svg.append(viewportRect);
    const attribute = (element, name, value) => { if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value)); };
    function draw() {
      const current = state(); toggleMap.hidden = current.view !== 'canvas';
      q('summary',more).setAttribute('aria-label', current.view === 'canvas' ? 'More canvas controls' : 'More screen controls');
      map.hidden = current.view !== 'canvas' || !minimapOpen || root.dataset.designPresentation === 'true'; toggleMap.setAttribute('aria-pressed', String(minimapOpen)); if (map.hidden) return;
      const boards = payload.entries.filter(item => !stage.getPanel(item.artifactId)?.hidden).map(item => { const panel = stage.getPanel(item.artifactId), frame = design.frames.find(value => value.id === item.frameId); return { ...item, x: parseFloat(panel.style.left) || 0, y: parseFloat(panel.style.top) || 0, width: frame.width, height: frame.height }; });
      if (!boards.length) return;
      const viewport = { x: -current.camera.x / current.zoom, y: -current.camera.y / current.zoom, width: scroll.clientWidth / current.zoom, height: scroll.clientHeight / current.zoom };
      // Board bounds are independent of the camera. Including the viewport in
      // these bounds made every zoom shrink/recenter the whole overview.
      const minX = Math.min(...boards.map(item => item.x)), minY = Math.min(...boards.map(item => item.y));
      const width = Math.max(...boards.map(item => item.x + item.width)) - minX, height = Math.max(...boards.map(item => item.y + item.height)) - minY;
      const scale = Math.min(184 / Math.max(1, width), 112 / Math.max(1, height));
      const offsetX = (200 - width * scale) / 2, offsetY = (128 - height * scale) / 2;
      geometry = { minX, minY, scale, viewport, offsetX, offsetY };
      const place = (element, box) => { for (const [key, value] of Object.entries({ x: offsetX + (box.x - minX) * scale, y: offsetY + (box.y - minY) * scale, width: Math.max(1, box.width * scale), height: Math.max(1, box.height * scale) })) attribute(element,key,value); };
      const visible = new Set(boards.map(board => board.artifactId));
      for (const [id, value] of mapBoards) if (!visible.has(id)) { value.remove(); mapBoards.delete(id); }
      for (const board of boards) {
        let value = mapBoards.get(board.artifactId);
        if (!value) {
          value = document.createElementNS(svg.namespaceURI, 'rect');
          for (const [key, entry] of Object.entries({ class:'design-minimap-board', 'data-map-artifact':board.artifactId, role:'button', tabindex:'0', 'aria-label':`Focus ${design.screens.find(item => item.id === board.screenId).title}, ${board.frameId}` })) attribute(value,key,entry);
          mapBoards.set(board.artifactId,value); svg.insertBefore(value,viewportRect);
        }
        place(value,board);
      }
      place(viewportRect,viewport);
    }
    const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; draw(); }); } };
    on(root, 'planr:design-render', schedule); on(root, 'planr:design-camera', schedule); on(window, 'resize', schedule);
    let dragging = false;
    const move = event => { if (!geometry) return; const bounds = svg.getBoundingClientRect(); const x = (event.clientX - bounds.left) * 200 / bounds.width, y = (event.clientY - bounds.top) * 128 / bounds.height; const worldX = geometry.minX + (x - geometry.offsetX) / geometry.scale, worldY = geometry.minY + (y - geometry.offsetY) / geometry.scale; studio.setCamera({ x: scroll.clientWidth / 2 - worldX * state().zoom, y: scroll.clientHeight / 2 - worldY * state().zoom }); };
    on(svg, 'pointerdown', event => { event.preventDefault(); dragging = true; svg.setPointerCapture(event.pointerId); move(event); });
    on(svg, 'pointermove', event => { if (dragging) move(event); }); for (const type of ['pointerup', 'pointercancel']) on(svg, type, () => { dragging = false; });
    on(svg, 'keydown', event => { if (!['Enter', ' '].includes(event.key)) return; const selected = payload.entries.find(item => item.artifactId === event.target.dataset.mapArtifact); if (selected) { event.preventDefault(); studio.selectEntry(selected); studio.fitSelection(); } });
    on(root, 'dblclick', event => { const header = event.target.closest('[data-design-drag]'); if (header && state().view === 'canvas') { event.preventDefault(); studio.selectEntry(payload.entries.find(item => item.artifactId === header.dataset.designDrag)); studio.fitSelection(); } });
    let chrome = null, focusBeforePresentation = null;
    const restore = () => {
      if (!chrome) return;
      const snapshot = chrome; chrome = null; root.dataset.designRestoring = 'true'; delete root.dataset.designPresentation;
      studio.restorePresentation(snapshot); presentation.textContent = 'Present fullscreen'; exit.hidden = true;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (disposed) return; studio.restorePresentation(snapshot); delete root.dataset.designRestoring; const hiddenMenu = focusBeforePresentation?.closest('details:not([open])'); const target = hiddenMenu ? q('summary',hiddenMenu) : focusBeforePresentation?.isConnected && focusBeforePresentation.getClientRects().length ? focusBeforePresentation : q('summary',more); target?.focus(); schedule(); }));
    };
    const exit = button('Exit presentation', async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); restore(); }, { class: 'design-exit-presentation', hidden: '' }); root.append(exit);
    const settlePresentation = async () => {
      // Fullscreen and panel collapse both change the stage's containing block.
      // Measuring in the click task can observe a zero/intermediate viewport and
      // leave the selected artboard at the minimum zoom, outside the visible area.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!chrome || root.dataset.designPresentation !== 'true' || disposed) return;
      if (state().view === 'canvas') studio.fitSelection({ save: false });
      else studio.fit({ save: false });
      schedule();
    };
    async function fullscreen() {
      if (chrome) { await exit.click(); return; }
      chrome = state(); focusBeforePresentation = document.activeElement; root.dataset.designPresentation = 'true'; inspector(false); studio.setPanels({ navOpen: false, reviewOpen: false }, { save: false }); presentation.textContent = 'Exit presentation'; exit.hidden = false;
      if (root.requestFullscreen) { try { await root.requestFullscreen(); } catch { announce('Presentation view is ready. Fullscreen is unavailable in this browser.'); } }
      await settlePresentation();
    }
    on(document, 'fullscreenchange', () => { if (!document.fullscreenElement) restore(); });
    on(document, 'keydown', event => { if (event.key === 'Escape' && chrome && !activeDialog) { event.preventDefault(); restore(); return; } if (event.target.closest('input,textarea,select,[contenteditable="true"]') || activeDialog) return; if (event.shiftKey && ['1', '!'].includes(event.key)) { event.preventDefault(); studio.fit(); } else if (event.shiftKey && ['2', '@'].includes(event.key)) { event.preventDefault(); studio.fitSelection(); } else if (event.key === '?') { event.preventDefault(); shortcuts(); } });
    draw();
  }
  function shortcuts() {
    const { content } = modal('Keyboard shortcuts'); const table = node('dl', '', { class: 'design-shortcuts' });
    for (const [key, description] of [['I', 'Interact with the product'], ['C', 'Annotate the design'], ['H', 'Select the Pan tool'], ['Space + drag', 'Temporarily pan, then return to the selected tool'], ['Middle mouse / trackpad', 'Move around the canvas from anywhere'], ['Ctrl / ⌘ + wheel', 'Zoom around the pointer'], ['Shift + 1', 'Fit all artboards'], ['Shift + 2', 'Fit the selected artboard'], ['Double-click artboard title', 'Focus an artboard'], ['Arrows on artboard title', 'Move artboard · hold Shift for larger steps'], ['← / → in walkthrough', 'Previous / next screen'], ['Escape', 'Leave Pan or Inspect; dismiss notes, dialogs or presentation'], ['?', 'Show these shortcuts']]) table.append(node('dt', key), node('dd', description)); content.append(table);
  }
  let inspectContent, reviewTabs, inspectOverlays = [], inspectedTarget = null;
  function inspector(enabled) {
    if (enabled && payload.staticArtifacts?.includes(entry()?.artifactId)) { announce('This screen is a static reference. Read its authored guidance; component internals are not available.'); enabled = false; }
    studio.setTool(enabled ? 'inspect' : 'interact');
  }
  function applyInspector(enabled) {
    inspectorEnabled = enabled; root.dataset.designInspect = String(enabled);
    if (enabled) studio.setPanels({ reviewOpen: true });
    for (const overlay of inspectOverlays) overlay.hidden = !enabled;
    const picker = q('[data-design-inspect-mode]'); picker?.setAttribute('aria-pressed', String(enabled));
    const selectControl = q('[data-design-inspect-start]'); if (selectControl) { selectControl.textContent = enabled ? 'Stop selecting elements' : 'Select an element'; selectControl.setAttribute('aria-pressed', String(enabled)); }
  }
  function installInspector() {
    if (reviewerAudience()) return;
    const reviewBody = node('section', '', { class: 'design-review-panel', id: 'design-review-panel', role: 'tabpanel', 'aria-labelledby': 'design-review-tab' });
    for (const child of [...rail.children]) if (child.tagName !== 'HEADER' && !child.classList.contains('design-resize-handle')) reviewBody.append(child);
    rail.append(reviewBody);
    reviewTabs = node('div', '', { class: 'design-rail-tabs', role: 'tablist', 'aria-label': 'Sidebar content' });
    const reviewButton = button('Review', () => switchRail('review'), { role: 'tab', 'aria-selected': 'true', 'aria-controls': 'design-review-panel', id: 'design-review-tab' });
    const inspectButton = button('Inspect', () => switchRail('inspect'), { role: 'tab', 'aria-selected': 'false', 'aria-controls': 'design-inspect-panel', id: 'design-inspect-tab', tabindex: '-1' }); reviewTabs.append(reviewButton, inspectButton); rail.querySelector('header').after(reviewTabs);
    inspectContent = node('section', '', { class: 'design-inspector', id: 'design-inspect-panel', role: 'tabpanel', 'aria-labelledby': 'design-inspect-tab', hidden: '' }); rail.append(inspectContent);
    const picker = button('Inspect', () => { switchRail('inspect'); inspector(!inspectorEnabled); }, { 'data-design-inspect-mode': '', 'aria-pressed': 'false', title: 'Inspect a product element without activating it' }); q('.design-interaction-picker').append(picker);
    on(reviewTabs, 'keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); switchRail(railTab === 'review' ? 'inspect' : 'review'); q('[aria-selected="true"]', reviewTabs).focus(); } });
    const selectTarget = async (value, overlay, point) => {
      const bridge = stage.getFrame(value.artifactId)?.__openPlanrBridge;
      try { const result = point ? await bridge?.inspectAt?.(point.x, point.y) : await bridge?.inspect?.(value); if (!result) throw new Error('Element inspection is unavailable for this screen. Authored implementation guidance is available below.'); renderInspector(result); if (overlay && result.rect) { let highlight = q('.design-inspect-highlight', overlay); if (!highlight) { highlight = node('span', '', { class: 'design-inspect-highlight' }); overlay.append(highlight); } Object.assign(highlight.style, { left: `${result.rect.x}px`, top: `${result.rect.y}px`, width: `${result.rect.width}px`, height: `${result.rect.height}px` }); } }
      catch (error) { announce(error.message, true); }
    };
    for (const value of payload.entries) {
      const panel = stage.getPanel(value.artifactId), frame = stage.getFrame(value.artifactId);
      const overlay = node('div', '', { class: 'design-inspect-overlay', role: 'button', tabindex: '0', 'aria-label': `Inspect elements in ${design.screens.find(item => item.id === value.screenId).title}`, hidden: '' }); q('.planr-frame', panel).append(overlay); inspectOverlays.push(overlay);
      on(overlay, 'pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
      on(overlay, 'click', event => { event.preventDefault(); event.stopPropagation(); const rect = frame.getBoundingClientRect(), viewport = design.frames.find(item => item.id === value.frameId); studio.selectEntry(value); void selectTarget(value, overlay, { x: clamp((event.clientX - rect.left) * viewport.width / rect.width, 0, viewport.width), y: clamp((event.clientY - rect.top) * viewport.height / rect.height, 0, viewport.height) }); });
      on(overlay, 'keydown', event => { if (event.key === 'Escape') { inspector(false); reviewButton.focus(); } else if (event.key === 'Enter') { event.preventDefault(); const first = design.screens.find(item => item.id === value.screenId)?.anchors?.[0]; if (first) void selectTarget({ ...value, planrId: first, screen: value.screenId }); else announce('This screen has no named element anchors. Use pointer inspection or read the screen guidance.'); } });
    }
    on(root, 'planr:design-tool-change', event => applyInspector(event.detail.tool === 'inspect'));
    const selection = () => `${state().screenId}:${state().frameId}:${state().variantId}`;
    let selected = selection(); on(root, 'planr:design-render', () => { if (inspectorEnabled) for (const value of payload.entries) stage.getFrame(value.artifactId).tabIndex = -1; if (selected !== selection()) { selected = selection(); inspectedTarget = null; if (payload.staticArtifacts?.includes(entry()?.artifactId)) inspector(false); if (railTab === 'inspect') renderInspector(); } });
    renderInspector();
  }
  function switchRail(tab) {
    if (!inspectContent) return;
    railTab = tab; root.dataset.designRailTab = tab; inspectContent.hidden = tab !== 'inspect'; q('#design-review-panel').hidden = tab !== 'review'; studio.setPanels({ reviewOpen: true });
    qa('[role="tab"]', reviewTabs).forEach(value => { const selected = value.textContent.toLowerCase() === tab; value.setAttribute('aria-selected', String(selected)); value.tabIndex = selected ? 0 : -1; });
    if (tab === 'review') inspector(false); else renderInspector();
  }
  function renderInspector(computed = inspectedTarget) {
    if (!inspectContent) return;
    inspectedTarget = computed;
    const expanded = new Set(qa('details[open]', inspectContent).map(value => value.querySelector('summary')?.textContent));
    inspectContent.replaceChildren();
    inspectContent.append(node('p', 'Read-only implementation guidance', { class: 'design-eyebrow' }), node('h3', design.screens.find(item => item.id === state().screenId)?.title || 'Screen'));
    const inspectToggle = button(inspectorEnabled ? 'Stop selecting elements' : 'Select an element', () => { inspector(!inspectorEnabled); renderInspector(computed); }, { class: 'design-primary', 'data-design-inspect-start':'', 'aria-pressed': String(inspectorEnabled) }); inspectContent.append(inspectToggle);
    if (payload.staticArtifacts?.includes(entry()?.artifactId)) { inspectToggle.disabled = true; inspectContent.append(node('p', 'Static reference · depicted component internals are unavailable. The guidance below is authored separately.', {class:'design-muted'})); }
    if (computed) {
      const asset = ['IMG','SVG','CANVAS','IMAGE'].includes(String(computed.tagName).toUpperCase());
      const detail = node('details', '', { open: '' }); detail.append(node('summary', `${asset ? 'Asset properties' : 'Computed'} · ${computed.tagName || 'element'}`));
      const values = node('dl', '', { class: 'design-inspect-values' });
      for (const [key, value] of Object.entries(computed.rect || {})) values.append(node('dt', key), node('dd', `${Math.round(value * 100) / 100}px`));
      if (computed.anchor?.planrId) values.append(node('dt', 'Anchor'), node('dd', computed.anchor.planrId));
      for (const [key, value] of Object.entries(computed.styles || {})) values.append(node('dt', key), node('dd', String(value)));
      for (const [key, value] of Object.entries(computed.accessibility || {})) if (value !== null && value !== '') values.append(node('dt', key), node('dd', String(value)));
      detail.append(values, node('p', asset ? 'This is an image or vector asset. Its depicted component internals cannot be inspected. Use authored implementation guidance below.' : 'Computed in this frame. These values describe the current render, not a reusable component contract.', { class: 'design-muted' })); inspectContent.append(detail);
    }
    const implementation = (experience?.reviewContext || payload.reviewContext)?.implementation || {};
    const section = (title, values, renderValue) => { const detail = node('details'); detail.append(node('summary', title)); if (!values?.length) detail.append(node('p', 'Not documented for this design yet.', { class: 'design-muted' })); else values.forEach(value => detail.append(renderValue(value))); inspectContent.append(detail); };
    section('Authored tokens', implementation.tokens, value => { const line = node('div', '', { class: 'design-token' }); line.append(node('strong', value.name), node('code', value.value)); if (value.description) line.append(node('p', value.description)); return line; });
    section('Components & states', implementation.components?.filter(value => !value.screenIds?.length || value.screenIds.includes(state().screenId)), value => { const group = node('div', '', { class: 'design-component-guide' }); group.append(node('h4', value.name)); if (value.notes) group.append(node('p', value.notes)); for (const item of value.states || []) group.append(node('p', `${item.name}: ${item.description || ''}`)); if (value.responsive) group.append(node('p', `Responsive: ${value.responsive}`)); if (value.accessibility) group.append(node('p', `Accessibility: ${value.accessibility}`)); return group; });
    section('Responsive rules', implementation.responsive, text => node('p', text)); section('Accessibility requirements', implementation.accessibility, text => node('p', text));
    const screen = design.screens.find(value => value.id === state().screenId); if (screen.description) { const detail = node('details'); detail.append(node('summary', 'Screen notes'), node('p', screen.description)); inspectContent.append(detail); }
    for (const detail of qa('details', inspectContent)) if (expanded.has(detail.querySelector('summary')?.textContent)) detail.open = true;
  }
  async function history() {
    const { content, status, dialog } = modal('Revision history', 'design-history'); status.textContent = 'Loading published revisions…';
    try {
      const value = await request('listRevisions', 'revisionsUrl'); const revisions = Array.isArray(value) ? value : value.revisions || [];
      status.textContent = ''; if (!revisions.length) { content.append(node('p', 'This design has no earlier published revisions yet.')); return; }
      content.append(node('p', 'Compare published content. Comments stay attached to the revision where they were made.', { class: 'design-muted' }));
      if (revisions.length > 1) content.append(button('Compare latest revisions', () => compareRevisions(), {class:'design-primary'}));
      for (const [index, item] of revisions.entries()) { const id = item.revision || item.id; const card = node('article', '', { class: 'design-revision-item' }); card.append(node('strong', `${index === 0 ? 'Latest · ' : ''}${item.createdAt ? new Date(item.createdAt).toLocaleString() : id.slice(0, 12)}`)); if (item.summary) card.append(node('p', item.summary)); card.append(node('code', id.slice(0, 12)));
        const previous = revisions[index + 1];
        if (item.fingerprints?.length && previous?.fingerprints?.length) {
          const diffs = screenDifferences(previous.fingerprints, item.fingerprints); const changed = Object.values(diffs).filter(value => value !== 'Unchanged');
          card.append(node('span', changed.length ? `${changed.length} screens changed · ${[...new Set(changed)].join(', ')}` : 'Design unchanged · runtime or publication only', {class:'design-revision-badge'}));
        } else if (previous) card.append(node('span', 'Rendered-output comparison available', {class:'design-revision-badge'}));
        if (revisions.length > 1) card.append(button('Compare with current', () => compareRevisions(id, value.currentRevision || revisions[0].revision || revisions[0].id), { disabled: id === (value.currentRevision || revisions[0].revision || revisions[0].id) ? '' : undefined }));
        content.append(card);
      }
      if (!dialog.isConnected) return;
    } catch (error) { status.textContent = error.message; content.append(button('Retry', history)); }
  }
  async function loadRevision(id) { return options().loadRevision ? options().loadRevision(id) : request('loadRevision', 'revisionsUrl', { revision: id }); }
  function screenDifferences(before, after) {
    const ids = [...new Set([...before, ...after].map(item => item.screenId))];
    const signature = (items, field) => JSON.stringify(items.map(item => [`${item.variantId}:${item.frameId}`, item[field]]).sort((a,b)=>a[0].localeCompare(b[0])));
    return Object.fromEntries(ids.map(id => {
      const a = before.filter(item=>item.screenId===id), b = after.filter(item=>item.screenId===id);
      return [id, !a.length ? 'Added' : !b.length ? 'Removed' : signature(a,'contentDigest') !== signature(b,'contentDigest') ? 'Changed' : signature(a,'guidanceDigest') !== signature(b,'guidanceDigest') ? 'Notes' : 'Unchanged'];
    }));
  }
  let badgeRevision = null;
  async function updateScreenBadges() {
    if (badgeRevision === revision() || !(options().revisionsUrl || options().listRevisions)) return;
    badgeRevision = revision();
    try {
      const value = options().listRevisions ? await options().listRevisions({brief:true}) : await request('listRevisions','revisionsUrl'); const revisions = Array.isArray(value) ? value : value.revisions || [];
      const index = Math.max(0,revisions.findIndex(item => (item.revision || item.id) === revision())); const previous = revisions[index+1];
      if (!previous) return;
      const old = previous.fingerprints?.length ? previous : await loadRevision(previous.revision || previous.id);
      const current = experience?.fingerprints || payload.fingerprints;
      if (!old.fingerprints?.length || !current?.length || disposed) return;
      const differences = screenDifferences(old.fingerprints,current);
      for (const screen of qa('[data-design-screen]')) { q('.design-screen-change',screen)?.remove(); const change = differences[screen.dataset.designScreen]; if (change && change !== 'Unchanged') screen.append(node('span',change,{class:'design-screen-change'})); }
    } catch { /* History retains an explicit retry state without blocking the current design. */ badgeRevision = null; }
  }
  async function compareRevisions(beforeId, afterId) {
    const { content, status, dialog } = modal('Compare revisions', 'design-comparison'); status.textContent = 'Loading both revisions…';
    const observers = []; let pairSerial = 0, renderSerial = 0;
    dialog.addEventListener('close', () => observers.splice(0).forEach(value => value.disconnect()));
    try {
      const history = await request('listRevisions', 'revisionsUrl');
      const revisions = Array.isArray(history) ? history : history.revisions || [];
      if (!revisions.length) { status.textContent = 'No published revisions are available for comparison.'; return; }
      afterId ||= history.currentRevision || revisions[0].revision || revisions[0].id;
      beforeId ||= revisions.find(item => (item.revision || item.id) !== afterId)?.revision || revisions.find(item => (item.revision || item.id) !== afterId)?.id || afterId;
      const revisionChoices = revisions.map(item => [item.revision || item.id, `${item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Revision'} · ${(item.revision || item.id).slice(0,8)}`]);
      const beforeSelect = select('Before revision', revisionChoices, beforeId), afterSelect = select('After revision', revisionChoices, afterId);
      const revisionsRow = node('div', '', { class: 'design-comparison-controls' });
      for (const [title, field] of [['Before', beforeSelect], ['After', afterSelect]]) { const label = node('label', title); label.append(field); revisionsRow.append(label); } content.append(revisionsRow);
      const screenSelect = select('Comparison screen', [], ''), frameSelect = select('Comparison frame', [], ''), variantSelect = select('Comparison direction', [], '');
      const controls = node('div', '', { class: 'design-comparison-controls' }); controls.append(screenSelect, frameSelect, variantSelect); content.append(controls);
      const summary = node('p', '', { class: 'design-comparison-summary' }), boards = node('div', '', { class: 'design-comparison-boards' }); content.append(summary, boards);
      let before, after;
      const choices = (field, values, fallback) => { const current = field.value || fallback; field.replaceChildren(...values.map(([id, text]) => node('option', text, { value: id }))); field.value = values.some(([id]) => id === current) ? current : values[0]?.[0] || ''; };
      const title = id => after.design.screens.find(item => item.id === id)?.title || before.design.screens.find(item => item.id === id)?.title || id;
      const render = async () => {
        const attempt = ++renderSerial; observers.splice(0).forEach(value => value.disconnect()); boards.replaceChildren(); status.textContent = 'Preparing isolated previews…';
        const selectedScreen = screenSelect.value, selectedFrame = frameSelect.value, selectedVariant = variantSelect.value;
        const matches = item => item.screenId === selectedScreen && item.frameId === selectedFrame && item.variantId === selectedVariant;
        const a = before.fingerprints?.find(matches), b = after.fingerprints?.find(matches);
        const beforeEntry = before.entries.find(matches), afterEntry = after.entries.find(matches);
        summary.textContent = !beforeEntry ? 'Added screen, frame or direction' : !afterEntry ? 'Removed screen, frame or direction' : !a || !b ? 'Rendered-output comparison · authored source fingerprints are unavailable for this revision' : a.contentDigest !== b.contentDigest ? 'Product design changed' : a.guidanceDigest !== b.guidanceDigest ? 'Guidance changed · product design unchanged' : 'Product design and guidance unchanged · publication or studio runtime only';
        const windows = [];
        for (const [name, bundle, id, selectedEntry] of [['Before', before, beforeSelect.value, beforeEntry], ['After', after, afterSelect.value, afterEntry]]) {
          const card = node('section', '', { class: 'design-comparison-card', 'aria-label': `${name} revision` }); card.append(node('h3', `${name} · ${id.slice(0,8)}`)); boards.append(card);
          if (!selectedEntry) { card.append(node('p', 'This screen, direction or frame does not exist in this revision.', { class: 'design-comparison-missing' })); continue; }
          const artifact = bundle.envelope.artifacts.find(item => item.id === selectedEntry.artifactId);
          let source = bundle.comparisonSources?.[artifact.id];
          if (!source && typeof options().prepareComparisonSource === 'function') source = await options().prepareComparisonSource({ artifact, revision: id });
          if (attempt !== renderSerial || !dialog.isConnected) return;
          if (typeof source !== 'string') { card.append(node('p', 'Isolated comparison is unavailable in this host. The current design remains usable.', { class: 'design-comparison-missing' })); continue; }
          const viewport = artifact.viewport || bundle.design.frames.find(item => item.id === selectedFrame);
          const windowNode = node('div', '', { class: 'design-comparison-window', tabindex: '0', 'aria-label': `Scroll ${name.toLowerCase()} preview` });
          const scaled = node('div', '', { class: 'design-comparison-scaled' });
          const iframe = node('iframe', '', { sandbox: 'allow-scripts allow-forms', referrerpolicy: 'no-referrer', title: `${name}: ${title(selectedScreen)}`, tabindex: '-1' });
          iframe.srcdoc = source; iframe.style.width = `${viewport.width}px`; iframe.style.height = `${viewport.height}px`; scaled.append(iframe); windowNode.append(scaled); card.append(windowNode); windows.push(windowNode);
          const comments = (bundle.review?.pins || bundle.envelope.review?.pins || []).filter(pin => pin.artifactId === artifact.id);
          const commentList = node('details'); commentList.append(node('summary', `${comments.length} comments on this revision`));
          for (const [index,pin] of comments.entries()) {
            const quote = node('p', `${pin.author?.name || 'Reviewer'}: ${pin.comment}`); quote.id = `compare-${name}-${index}`; commentList.append(quote);
            const marker = button(String(index + 1), () => { commentList.open = true; quote.scrollIntoView({block:'nearest'}); }, {class:'design-comparison-pin', 'aria-label': `Read ${name.toLowerCase()} comment ${index+1}`});
            marker.style.left = `${pin.region.x*100}%`; marker.style.top = `${pin.region.y*100}%`; scaled.append(marker);
          }
          if (comments.length) card.append(commentList);
          const fit = () => { const ratio = Math.min(1, windowNode.clientWidth / viewport.width); iframe.style.transform = `scale(${ratio})`; scaled.style.height = `${viewport.height * ratio}px`; };
          requestAnimationFrame(fit); if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(fit); observer.observe(windowNode); observers.push(observer); }
          const notes = bundle.design.screens.find(item=>item.id===selectedScreen)?.description; if (notes) { const detail=node('details');detail.append(node('summary','Notes on this revision'),node('p',notes));card.append(detail); }
        }
        let scrolling = false;
        for (const windowNode of windows) windowNode.addEventListener('scroll', () => { if (scrolling) return; scrolling = true; for (const other of windows) if (other !== windowNode) other.scrollTop = (windowNode.scrollTop / Math.max(1,windowNode.scrollHeight - windowNode.clientHeight)) * Math.max(0,other.scrollHeight - other.clientHeight); requestAnimationFrame(()=>{scrolling=false;}); });
        status.textContent = 'Read-only comparison · scrolling is synchronized. Return to the design to interact or comment.';
      };
      const loadPair = async () => {
        const attempt=++pairSerial; status.textContent='Loading revisions…';
        try {
          const pair=await Promise.all([loadRevision(beforeSelect.value),loadRevision(afterSelect.value)]); if (attempt!==pairSerial || !dialog.isConnected)return;[before,after]=pair;
          const ids=[...new Set([...after.design.screenOrder,...before.design.screenOrder])];choices(screenSelect,ids.map(id=>[id,title(id)]),state().screenId);
          const frames=[...new Map([...after.design.frames,...before.design.frames].map(item=>[item.id,item])).values()];choices(frameSelect,frames.map(item=>[item.id,item.label]),state().frameId);
          const variants=[...new Map([...after.design.variants,...before.design.variants].filter(item=>item.status==='ready').map(item=>[item.id,item])).values()];choices(variantSelect,variants.map(item=>[item.id,item.label]),state().variantId);
          await render();
        } catch(error){status.textContent=error.message;}
      };
      for (const field of [beforeSelect,afterSelect]) field.addEventListener('change',()=>void loadPair());
      for (const field of [screenSelect,frameSelect,variantSelect]) field.addEventListener('change',()=>void render().catch(error=>{status.textContent=error.message;}));
      await loadPair();
    } catch (error) { status.textContent = error.message; content.append(button('Retry comparison', () => compareRevisions(beforeId, afterId))); }
  }
  async function handoff() {
    const { content, status } = modal('Review handoff', 'design-handoff'); status.textContent = 'Loading review decisions…'; let response;
    const render = () => {
      content.replaceChildren(); const draft = response.draft;
      content.append(node('p', 'Turn accepted feedback into a proposed implementation brief. Approval records your decision; Plan remains a separate invocation.', { class: 'design-muted' }));
      if (!draft) { content.append(button('Generate proposed handoff', () => act({ action: 'draft', version: 0 }), { class: 'design-primary' })); return; }
      content.append(node('p', response.current ? (draft.status === 'approved' ? 'Approved for this design and feedback snapshot.' : 'Ready for your review.') : 'Outdated: the design or feedback changed. Regenerate before approval.', { class: 'design-handoff-state' }));
      const title = node('label', 'Summary'); const summary = node('textarea', '', { 'aria-label': 'Handoff summary', maxlength: '16384' }); summary.value = draft.content.summary || ''; title.append(summary); content.append(title);
      const fields = {};
      for (const [key, title] of [['agreedChanges', 'Accepted changes'], ['openQuestions', 'Unresolved questions & blockers'], ['deferred', 'Deferred'], ['rejected', 'Declined']]) {
        const group = node('section'); group.append(node('h3', title)); fields[key] = [];
        if (!(draft.content[key] || []).length) group.append(node('p', 'None recorded.', { class: 'design-muted' }));
        for (const item of draft.content[key] || []) { const field = node('textarea', '', { 'aria-label': `${title}: ${item.pinId || 'note'}`, maxlength: '8192' }); field.value = item.refinement || ''; fields[key].push({ field, item }); group.append(node('blockquote', item.text, { class: 'design-review-quote' }), node('label', 'Implementation refinement'), field); if (item.pinId) group.append(button(`View comment ${item.pinId.slice(0, 8)}`, () => { activeDialog?.dismiss(); const currentReview = stage.review.getState().review; if ((item.revisionId && item.revisionId !== revision()) || (item.reviewOf && item.reviewOf !== currentReview?.reviewOf) || (item.reviewId && item.reviewId !== currentReview?.reviewId)) { void history(); announce('This source comment belongs to another review snapshot. Inspect its original revision; it has not been relocated.'); return; } const pin = currentReview?.pins.find(value => value.id === item.pinId); if (pin) { const value = payload.entries.find(value => value.artifactId === pin.artifactId); if (value) studio.selectEntry(value); stage.review.selectPin?.(pin.id); studio.setPanels({ reviewOpen: true }); } else announce('This comment belongs to an earlier revision. Open revision history to inspect it.'); }, { class: 'design-text-button' })); }
        content.append(group);
      }
      let edited = false;
      const actions = node('div', '', { class: 'design-dialog-actions' });
      const save = button('Save draft', () => act({ action: 'update', version: draft.version, content: { ...draft.content, summary: summary.value, ...Object.fromEntries(Object.entries(fields).map(([key, items]) => [key, items.map(({ field, item }) => ({ ...item, refinement: field.value }))])) } }));
      const approve = button('Approve handoff', () => act({ action: 'approve', version: draft.version, contentHash: draft.contentHash }), { class: 'design-primary' }); approve.disabled = !response.current || draft.status === 'approved';
      for (const input of qa('textarea', content)) input.addEventListener('input', () => { edited = true; approve.disabled = true; status.textContent = 'Save your edits before approving.'; });
      const regenerate = button('Regenerate from reviews', () => { if (!edited || window.confirm('Replace your unsaved handoff edits with current review decisions?')) void act({ action: 'draft', version: draft.version }); }); actions.append(save, approve, regenerate); content.append(actions);
      if (draft.markdown) content.append(button('Copy handoff', async () => { try { await navigator.clipboard.writeText(draft.markdown); status.textContent = 'Handoff copied.'; } catch { const output = node('textarea', '', { 'aria-label': 'Copy handoff Markdown', readonly: '' }); output.value = draft.markdown; content.append(output); output.focus(); output.select(); } }));
    };
    const act = async input => {
      const previousDisabled = new Map(qa('button', content).map(value => [value,value.disabled]));
      qa('button', content).forEach(value => { value.disabled = true; }); status.textContent = 'Saving…';
      try { response = await request('updateHandoff', 'handoffUrl', { ...input, revision: revision() }); if (response.metadata) metadata = response.metadata; render(); status.textContent = input.action === 'approve' ? 'Handoff approved. Invoke Plan separately when you are ready.' : 'Draft saved.'; updateFilters(); }
      catch (error) { status.textContent = error.message; for (const [value,disabled] of previousDisabled) if (value.isConnected) value.disabled = disabled; }
    };
    try { response = await request('loadHandoff', 'handoffUrl'); if (response.metadata) metadata = response.metadata; render(); status.textContent = ''; }
    catch (error) { status.textContent = error.message; content.append(button('Retry', handoff)); }
  }
  async function refreshExperience() {
    const previousContext = JSON.stringify(experience?.reviewContext || payload.reviewContext);
    try { experience = await request('loadExperience', 'experienceUrl'); metadata = experience.metadata || metadata; }
    catch { experience = { reviewContext: payload.reviewContext, capabilities: { owner: Boolean(options().handoffUrl), revisions: Boolean(options().revisionsUrl || options().listRevisions), handoff: Boolean(options().handoffUrl || options().updateHandoff) } }; }
    if (disposed) return;
    updateFilters(); if (previousContext !== JSON.stringify(experience?.reviewContext || payload.reviewContext)) renderInspector();
    let actionBar = q('.design-experience-actions'); if (!actionBar) { actionBar = node('div', '', { class: 'design-experience-actions' }); q('.design-nav-footer').before(actionBar); }
    const signature = `${owner()}:${Boolean(experience.capabilities?.revisions || options().listRevisions || options().revisionsUrl)}:${Boolean(options().handoffUrl || options().updateHandoff)}`;
    if (actionBar.dataset.signature !== signature) {
      actionBar.dataset.signature = signature; actionBar.replaceChildren(button('About this review', () => about()));
      if (experience.capabilities?.revisions || options().listRevisions || options().revisionsUrl) actionBar.append(button('Revision history', history));
      if (owner() && (options().handoffUrl || options().updateHandoff)) actionBar.append(button('Prepare handoff', handoff));
    }
    void updateScreenBadges();
  }
  function mount() {
    studio = window.__openPlanrDesignStudio; stage = window.__openPlanrArtifactStage; root = q('.planr-shell'); rail = q('.planr-review-rail');
    root.dataset.designAudience=reviewerAudience() ? 'reviewer' : 'owner';
    if (reviewerAudience()) for (const value of qa('.design-direction-review,[data-design-verification],.planr-decision-slot')) value.hidden=true;
    installMobileViewport(); installProfileAndTheme(); installReadability(); installReview(); installComposerCategory(); installInspector(); installCanvas(); installThumbnails(); installPersonalDrafts();
    // The published payload already contains the authorized introduction. Show
    // it before any asynchronous metadata refresh can expose the board first.
    about(true);
    options().onExperienceReady?.();
    void refreshExperience();
    on(document, 'planr:design-experience-change', event => { if (event.detail?.metadata) { metadata = event.detail.metadata; updateFilters(); } if (event.detail?.reviewContext) { experience = { ...experience, reviewContext: event.detail.reviewContext }; renderInspector(); } });
    on(document, 'openplanr:design-experience-changed', () => { void refreshExperience(); });
    const dispose = () => { disposed = true; activeDialog?.dismiss(); for (const remove of destroyers.splice(0)) remove(); clearTimeout(toastTimer); };
    on(window, 'pagehide', dispose); on(root, 'planr:design-destroy', dispose);
    window.__openPlanrDesignExperience = Object.freeze({ about, profile:editProfile, setTheme, history, compare: compareRevisions, handoff, refresh: refreshExperience, getState: () => ({ railTab, inspectorEnabled, profile:{...profile}, theme:themePreference, metadata: structuredClone(metadata) }) });
  }
  const started = Date.now();
  function boot() { if (document.getElementById('planr-design-studio-payload') !== payloadNode) return; if (window.__openPlanrDesignStudio && window.__openPlanrArtifactStage) mount(); else if (Date.now() - started < 15000) setTimeout(boot, 30); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
