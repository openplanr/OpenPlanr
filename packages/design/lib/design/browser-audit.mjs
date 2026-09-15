/**
 * Evaluate inside an authored screen's browsing context. Deliberately has no
 * closure dependencies: browser tools can evaluate this function's source.
 * It inspects rendered CSS and geometry; it does not exercise product actions.
 */
export function auditRenderedScreen() {
  const issues = [];
  const add = (rule, severity, message) => issues.push({ rule, severity, message });
  const label = (node) => node.getAttribute('data-planr-id') || node.id || `${node.tagName.toLowerCase()} “${(node.textContent || node.getAttribute('aria-label') || '').trim().replace(/\s+/gu, ' ').slice(0, 60)}”`;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const screenId = document.body?.getAttribute('data-planr-screen') ?? null;
  if (!screenId) add('screen-not-loaded', 'error', 'The frame has no authored design screen identity.');
  if (document.readyState !== 'complete') add('screen-loading', 'error', `The frame is still ${document.readyState}.`);
  const nodes = [...document.querySelectorAll('body *')];
  if (nodes.length > 5000) add('audit-limit', 'error', 'The screen exceeds the 5,000 element audit limit; inspect and split the screen before verification.');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const color = (input) => {
    if (!context) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = input;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].map((value) => value / 255);
  };
  const over = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));
  const luminance = (rgb) => rgb.reduce((sum, value, index) => sum + [0.2126, 0.7152, 0.0722][index] * (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4), 0);
  const effectiveBackground = (node) => {
    const chain = [];
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) chain.unshift(ancestor);
    let background = [1, 1, 1];
    for (const ancestor of chain) {
      const style = getComputedStyle(ancestor);
      if (style.backgroundImage !== 'none' || Number(style.opacity) < 1 || style.mixBlendMode !== 'normal' || style.filter !== 'none') return null;
      const resolved = color(style.backgroundColor);
      if (!resolved) return null;
      background = over(resolved, background);
    }
    return background;
  };
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && !node.closest('[hidden],[aria-hidden="true"],[inert]')
      && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) > 0;
  };
  let checkedElements = 0, checkedContrast = 0, skippedContrast = 0, checkedFocus = 0;
  const focusTargets = [];
  for (const node of nodes.slice(0, 5000)) {
    if (!visible(node)) continue;
    checkedElements += 1;
    const style = getComputedStyle(node);
    const directText = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    if (node.tagName === 'IMG' && (!node.complete || node.naturalWidth === 0)) add('missing-image', 'error', `${label(node)} has not loaded its image.`);
    if (directText) {
      const background = effectiveBackground(node);
      const foreground = color(style.color);
      if (background && foreground) {
        const a = luminance(over(foreground, background)), b = luminance(background);
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.666 && parseFloat(style.fontWeight) >= 700);
        const required = large ? 3 : 4.5;
        checkedContrast += 1;
        if (ratio + .01 < required) add('contrast-below-aa', 'error', `${label(node)} has computed contrast ${ratio.toFixed(2)}:1; ${required}:1 is required.`);
      } else skippedContrast += 1;
      if (!['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) {
        const clipsX = ['hidden', 'clip'].includes(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        const clipsY = ['hidden', 'clip'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        if (clipsX || clipsY) {
          const intentional = style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none');
          add('clipped-content', intentional ? 'warning' : 'error', `${label(node)} clips ${clipsX ? 'horizontal' : 'vertical'} text${intentional ? '; confirm intentional truncation in the screenshot' : ''}.`);
        }
      }
    }
    if (node.tabIndex >= 0 && !node.disabled && node.matches('button,a[href],input:not([type="hidden"]),select,textarea,[tabindex],[contenteditable="true"]')) {
      focusTargets.push(node);
      const name = node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/u).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
        || [...(node.labels || [])].map((item) => item.textContent).join(' ').trim() || node.getAttribute('title')
        || (node.matches('input[type="button"],input[type="submit"],input[type="reset"]') ? node.value : node.matches('input,select,textarea') ? '' : node.textContent.trim());
      if (!name) add('unnamed-control', 'error', `${label(node)} has no accessible name.`);
    }
  }
  if (document.documentElement.scrollWidth > viewport.width + 1) add('horizontal-overflow', 'error', `The screen is ${document.documentElement.scrollWidth}px wide in a ${viewport.width}px frame.`);
  if (checkedElements === 0) add('empty-render', 'error', 'The frame contains no visible rendered content.');
  if (skippedContrast > 0) add('contrast-needs-inspection', 'warning', `${skippedContrast} text elements use images, blending or transparency effects; inspect their screenshot contrast.`);
  if (document.fonts?.status === 'loading') add('fonts-loading', 'error', 'Fonts are still loading; inspect again after they settle.');

  const previousFocus = document.activeElement;
  const previousScroll = { x: window.scrollX, y: window.scrollY };
  let keyboardInspectionNeeded = 0;
  for (const node of focusTargets.slice(0, 150)) {
    const before = getComputedStyle(node);
    const baseline = [before.boxShadow, before.backgroundColor, before.borderColor, before.textDecorationLine];
    node.focus({ preventScroll: true });
    if (document.activeElement !== node) { add('unreachable-control', 'error', `${label(node)} cannot receive focus.`); continue; }
    if (!node.matches(':focus-visible')) { keyboardInspectionNeeded += 1; continue; }
    const focused = getComputedStyle(node);
    const outlined = focused.outlineStyle !== 'none' && parseFloat(focused.outlineWidth) > 0 && (color(focused.outlineColor)?.[3] ?? 0) > 0;
    const changed = [focused.boxShadow, focused.backgroundColor, focused.borderColor, focused.textDecorationLine].some((value, index) => value !== baseline[index]);
    checkedFocus += 1;
    if (!outlined && !changed) add('missing-focus-indicator', 'error', `${label(node)} has no visible keyboard focus style.`);
  }
  previousFocus?.focus?.({ preventScroll: true });
  if (document.activeElement !== previousFocus) document.activeElement?.blur?.();
  if (window.scrollX !== previousScroll.x || window.scrollY !== previousScroll.y) window.scrollTo(previousScroll.x, previousScroll.y);
  if (keyboardInspectionNeeded > 0) add('focus-needs-keyboard-inspection', 'warning', `${keyboardInspectionNeeded} controls need a keyboard focus walkthrough.`);
  if (focusTargets.length > 150) add('focus-audit-limit', 'warning', 'Only the first 150 focusable controls were inspected.');
  return { screenId, viewport, checkedElements, checkedContrast, skippedContrast, checkedFocus, issues };
}

/**
 * Browser-client agnostic orchestration. The caller owns the browser, screenshots
 * and explicit journey results; this module never installs or imports a browser.
 */
export async function auditDesignPage(page, { revision, entries = [], screenshotPaths = [], scenarios = [] } = {}) {
  const issues = [], checkedArtifacts = [], screens = [];
  const expected = new Map(entries.map((entry) => [entry.artifactId, entry]));
  const add = (artifactId, rule, severity, message) => issues.push({ artifactId, rule, severity, message });
  if (!entries.length || expected.size !== entries.length) add('studio', 'invalid-audit-scope', 'error', 'Audit scope must contain every expected artifact exactly once.');
  if (!page || typeof page.frames !== 'function') {
    return { schemaVersion: '1.0.0', revision, status: 'unverified', checkedArtifacts, issues: [{ artifactId: 'studio', rule: 'browser-unavailable', severity: 'warning', message: 'A browser page is required for rendered verification.' }], screenshots: screenshotPaths, scenarios, screens };
  }
  const loaded = new Set();
  for (const frame of page.frames()) {
    let handle, artifactId, panelState;
    try {
      if (frame === page.mainFrame?.()) continue;
      handle = await frame.frameElement();
      artifactId = await handle.getAttribute('data-planr-artifact-frame') ?? await handle.getAttribute('data-planr-artifact-id');
      if (!expected.has(artifactId)) continue;
      if (loaded.has(artifactId)) { add(artifactId, 'duplicate-frame', 'error', 'Multiple frames claim the same artifact identity.'); continue; }
      loaded.add(artifactId);
      await frame.waitForLoadState?.('load', { timeout: 5000 });
      panelState = await handle.evaluate((element) => {
        const panel = element.closest('[data-artifact-id]');
        if (!panel) return null;
        const hidden = panel.hidden;
        panel.hidden = false;
        return { hidden };
      });
      // A real keyboard event establishes focus-visible modality before the
      // screen helper inspects controls, without activating any product action.
      await page.keyboard?.press('Tab');
      const result = await frame.evaluate(auditRenderedScreen);
      if (result.screenId !== expected.get(artifactId).screenId) {
        add(artifactId, 'screen-identity-mismatch', 'error', `Expected screen ${expected.get(artifactId).screenId}; loaded ${result.screenId ?? 'none'}.`);
        continue;
      }
      checkedArtifacts.push(artifactId);
      screens.push({ artifactId, ...result });
      for (const issue of result.issues) add(artifactId, issue.rule, issue.severity, issue.message);
    } catch (error) {
      if (artifactId && expected.has(artifactId)) add(artifactId, 'frame-load-error', 'error', `The rendered frame could not be inspected: ${error.message}`);
    } finally {
      if (panelState && handle) {
        await handle.evaluate((element, state) => { const panel = element.closest('[data-artifact-id]'); if (panel) panel.hidden = state.hidden; }, panelState).catch(() => {});
      }
      await handle?.dispose?.();
    }
  }
  for (const artifactId of expected.keys()) {
    if (!checkedArtifacts.includes(artifactId)) add(artifactId, 'missing-frame-inspection', 'error', 'The expected artifact has no completed rendered inspection.');
  }
  for (const error of await page.pageErrors?.() ?? []) add('studio', 'browser-script-error', 'error', error.message ?? String(error));
  const evidenceComplete = screenshotPaths.length > 0 && scenarios.length > 0 && scenarios.every(({ status }) => status === 'passed');
  const status = issues.some(({ severity }) => severity === 'error') ? 'failed' : evidenceComplete ? 'verified' : 'unverified';
  return { schemaVersion: '1.0.0', revision, status, checkedArtifacts, issues, screenshots: screenshotPaths, scenarios, screens };
}
