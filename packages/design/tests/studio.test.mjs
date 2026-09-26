import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { renderArtifactShellDocument } from '@openplanr/artifact/ui/shell.mjs';
import { mountArtifactStage } from '@openplanr/artifact/ui/stage.mjs';
import {
  createDesignStudioEntries,
  designStudioArtifactId,
  renderDesignStudio,
} from '../lib/design/studio.mjs';

const cliRequire = createRequire(new URL('../../cli/package.json', import.meta.url));
const { JSDOM } = cliRequire('jsdom');
const runtime = readFileSync(new URL('../templates/studio/studio.js', import.meta.url), 'utf8');

function fixture({ count = 3, title = 'Fieldwork operations' } = {}) {
  const document = {
    kind: 'openplanr-design-document',
    schemaVersion: '1.0.0',
    id: 'fieldwork',
    title,
    brief: {
      text: 'Schedule field crews and review the delivery.',
      source: 'describe',
      provenance: 'inferred',
    },
    frames: [
      { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
    ],
    screens: Array.from({ length: count }, (_, index) => ({
      id: `screen-${index + 1}`,
      title: `Screen ${index + 1}`,
      description: `Journey step ${index + 1}.`,
      source: { html: `screens/screen-${index + 1}.html` },
    })),
    screenOrder: Array.from({ length: count }, (_, index) => `screen-${index + 1}`),
    variants: [
      { id: 'editorial', label: 'Editorial', status: 'ready' },
      { id: 'compact', label: 'Compact', status: 'ready' },
      {
        id: 'unfinished',
        label: 'Unfinished',
        status: 'failed',
        issue: 'Generation interrupted.',
      },
    ],
    selectedVariant: 'editorial',
    defaultView: 'canvas',
  };
  const artifacts = document.variants
    .filter(({ status }) => status === 'ready')
    .flatMap((variant) =>
      document.screens.flatMap((screen) =>
        document.frames.map((frame) => ({
          id: designStudioArtifactId(variant.id, screen.id, frame.id),
          title: `${screen.title} / ${variant.label} / ${frame.label}`,
          html: `<!doctype html><html><body><main data-planr-id="main"><h1>${screen.title}</h1><button>Primary action</button></main></body></html>`,
          viewport: { width: frame.width, height: frame.height },
        })),
      ),
    );
  const envelope = createArtifactEnvelope({
    artifacts,
    viewer: { mode: 'variants', presentation: 'canvas' },
  });
  const entries = createDesignStudioEntries(document, envelope);
  return { document, envelope, entries };
}

async function mount({ data = fixture(), options = {}, stored = null, experience = false } = {}) {
  const html = renderDesignStudio(data);
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/review/studio/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  window.Blob = Blob;
  window.URL.createObjectURL = () => `blob:http://127.0.0.1/${Math.random()}`;
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.scrollTo = function (value) {
    this.scrollLeft = value.left ?? this.scrollLeft;
    this.scrollTop = value.top ?? this.scrollTop;
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  if (stored)
    window.localStorage.setItem(
      `openplanr.design-studio.${data.document.id}`,
      JSON.stringify(stored),
    );
  window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ = options;
  const stage = mountArtifactStage({
    document: window.document,
    window,
    async resolveArtifactSource(artifact, { frame }) {
      setTimeout(() => frame.dispatchEvent(new window.Event('load')), 0);
      return data.envelope.artifacts.find(({ id }) => id === artifact.id).html;
    },
  });
  window.eval(runtime);
  await stage.ready;
  for (let index = 0; index < 20 && !window.__openPlanrDesignStudio; index += 1) await delay(10);
  assert.ok(window.__openPlanrDesignStudio, 'studio boots after artifact stage');
  if (experience) await delay(20);
  return {
    ...data,
    window,
    documentNode: window.document,
    stage,
    studio: window.__openPlanrDesignStudio,
    close() {
      window.__openPlanrDesignStudio.destroy();
      stage.destroy();
      window.close();
    },
  };
}

test('Notes dismisses without losing context and restores keyboard focus', async () => {
  const fixture = await mount();
  const { documentNode: document, window, studio } = fixture;
  try {
    const notes = document.querySelector('[data-design-notes]');
    const summary = notes.querySelector(':scope > summary');
    const first = document.querySelector('[data-design-note="screen-1"]');
    const second = document.querySelector('[data-design-note="screen-2"]');
    const close = notes.querySelector('[data-design-close-notes]');
    first.focus();
    first.click();
    assert.equal(notes.open, true);
    assert.equal(first.getAttribute('aria-expanded'), 'true');
    close.focus();
    close.click();
    assert.equal(notes.open, false);
    assert.equal(document.activeElement, first);
    assert.equal(first.getAttribute('aria-expanded'), 'false');
    first.click();
    first.click();
    assert.equal(notes.open, false, 'clicking the same screen info toggles Notes closed');
    first.click();
    second.click();
    assert.equal(notes.open, true, 'a different info control keeps Notes open');
    assert.equal(notes.querySelector('[data-design-note-screen="screen-1"]').open, false);
    assert.equal(notes.querySelector('[data-design-note-screen="screen-2"]').open, true);
    assert.equal(second.getAttribute('aria-expanded'), 'true');
    notes.querySelector('[data-design-note-screen="screen-2"] > summary').click();
    assert.equal(notes.open, true, 'accordion interaction does not dismiss the panel');
    close.focus();
    close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(notes.open, false);
    assert.equal(document.activeElement, second);
    summary.click();
    assert.equal(notes.open, true);
    assert.equal(summary.getAttribute('aria-expanded'), 'true');
    summary.click();
    assert.equal(notes.open, false);
    summary.click();
    document
      .querySelector('.planr-toolbar')
      .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(notes.open, false);
    summary.click();
    studio.setView('prototype');
    assert.equal(notes.open, false);
    assert.equal(
      notes.querySelectorAll('[data-design-note-screen]').length,
      3,
      'dismissal preserves the notes',
    );
  } finally {
    fixture.close();
  }
});

test('studio composes one toolbar and retains the artifact-owned review, bridge sandbox and failed directions', () => {
  const data = fixture({ title: '</script><img src=x onerror=alert(1)>' });
  const html = renderDesignStudio(data);
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('.planr-toolbar').length, 1);
  assert.equal(document.querySelectorAll('[data-design-view]').length, 3);
  assert.equal(
    document.querySelector('[data-design-toggle-nav]').getAttribute('aria-expanded'),
    'true',
  );
  assert.ok(document.querySelector('[data-planr-action="share"]'));
  assert.ok(document.querySelector('[data-planr-share-dialog]'));
  assert.equal(document.querySelectorAll('[data-planr-slot="feedback-rail"]').length, 1);
  assert.equal(document.querySelectorAll('[data-planr-artifact-frame]').length, 12);
  assert.equal(
    document.querySelector('iframe').getAttribute('sandbox'),
    'allow-scripts allow-forms',
  );
  assert.match(
    document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    /form-action 'none'/,
  );
  const generic = new JSDOM(renderArtifactShellDocument({ envelope: data.envelope }));
  assert.equal(
    generic.window.document.querySelector('iframe').getAttribute('sandbox'),
    'allow-scripts',
  );
  generic.window.close();
  assert.equal(document.querySelectorAll('[onerror]').length, 0);
  assert.match(
    document.querySelector('.design-failed-variants').textContent,
    /Generation interrupted/,
  );
  assert.equal(document.querySelector('option[value="unfinished"]').disabled, true);
  dom.window.close();
});

test('compact navigation and review rails collapse independently and persist', async () => {
  const saves = [];
  const app = await mount({
    options: {
      saveState: async (state) => {
        saves.push(state);
        return { stateVersion: saves.length };
      },
    },
  });
  try {
    const root = app.documentNode.querySelector('.planr-shell');
    const navigator = app.documentNode.querySelector('.design-navigator');
    const screens = app.documentNode.querySelector('[data-design-toggle-nav]');
    const feedback = app.documentNode.querySelector('[data-planr-action="feedback"]');
    assert.equal(root.dataset.designNavOpen, 'true');
    assert.equal(root.dataset.planrRailOpen, 'true');

    screens.click();
    assert.equal(root.dataset.designNavOpen, 'false');
    assert.equal(screens.getAttribute('aria-expanded'), 'false');
    assert.equal(navigator.getAttribute('aria-hidden'), 'true');
    assert.equal(navigator.inert, true);

    feedback.click();
    assert.equal(root.dataset.planrRailOpen, 'false');
    assert.equal(app.studio.getState().reviewOpen, false);
    await app.studio.flush();
    assert.equal(saves.at(-1).navOpen, false);
    assert.equal(saves.at(-1).reviewOpen, false);

    app.documentNode.querySelector('[data-planr-action="share"]').click();
    assert.equal(app.documentNode.querySelector('[data-planr-share-dialog]').hidden, false);
    app.documentNode.querySelector('[data-planr-share-close]').click();
    assert.equal(app.documentNode.querySelector('[data-planr-share-dialog]').hidden, true);
  } finally {
    app.close();
  }

  const reopened = await mount({ stored: { state: saves.at(-1) } });
  try {
    assert.equal(
      reopened.documentNode.querySelector('.planr-shell').dataset.designNavOpen,
      'false',
    );
    assert.equal(
      reopened.documentNode.querySelector('.planr-shell').dataset.planrRailOpen,
      'false',
    );
  } finally {
    reopened.close();
  }
});

test('stable artifact ids are unambiguous and bounded without losing long source identities', () => {
  assert.notEqual(designStudioArtifactId('a.b', 'c', 'd'), designStudioArtifactId('a', 'b.c', 'd'));
  const long = designStudioArtifactId(
    'variant'.repeat(30),
    'screen'.repeat(30),
    'mobile'.repeat(30),
  );
  assert.ok(long.length <= 128);
  assert.equal(
    long,
    designStudioArtifactId('variant'.repeat(30), 'screen'.repeat(30), 'mobile'.repeat(30)),
  );
  assert.notEqual(
    long,
    designStudioArtifactId('variant'.repeat(30), 'screen'.repeat(30), 'desktop'.repeat(30)),
  );
});

test('three views, responsive frames and variant comparison reuse the original loaded frames', async () => {
  const app = await mount();
  try {
    const frameSources = [...app.documentNode.querySelectorAll('iframe')].map((frame) => frame.src);
    const visible = () =>
      [...app.documentNode.querySelectorAll('.planr-artifact-panel')].filter(
        (panel) => !panel.hidden,
      );
    assert.equal(visible().length, 6);
    app.documentNode.querySelector('[data-design-view="prototype"]').click();
    assert.equal(visible().length, 1);
    const framePicker = app.documentNode.querySelector('[data-design-frame]');
    framePicker.value = 'mobile';
    framePicker.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(app.studio.getState().frameId, 'mobile');
    assert.equal(visible()[0].style.getPropertyValue('--planr-artifact-width'), '390px');
    const compare = app.documentNode.querySelector('[data-design-compare]');
    compare.checked = true;
    compare.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(visible().length, 1, 'focused views show only the selected direction');
    app.documentNode.querySelector('[data-design-view="walkthrough"]').click();
    assert.equal(app.documentNode.querySelector('.design-walkthrough-caption').hidden, false);
    app.documentNode.querySelector('[data-design-step-change="1"]').click();
    assert.equal(app.studio.getState().screenId, 'screen-2');
    assert.equal(
      app.documentNode.querySelector('[data-design-narrative]').textContent,
      'Journey step 2.',
    );
    app.studio.setView('canvas');
    assert.equal(visible().length, 12, 'canvas retains the comparison preference');
    assert.deepEqual(
      [...app.documentNode.querySelectorAll('iframe')].map((frame) => frame.src),
      frameSources,
    );
  } finally {
    app.close();
  }
});

test('canvas camera pans freely, artboards cross the origin, and each view restores its viewport', async () => {
  const app = await mount();
  try {
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    const entry = app.entries.find(
      (item) =>
        item.variantId === 'editorial' &&
        item.screenId === 'screen-1' &&
        item.frameId === 'desktop',
    );
    const drag = app.documentNode.querySelector(`[data-design-drag="${entry.artifactId}"]`);
    drag.dispatchEvent(
      new app.window.MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 100,
      }),
    );
    scroll.dispatchEvent(
      new app.window.MouseEvent('pointermove', {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }),
    );
    scroll.dispatchEvent(new app.window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    assert.ok(app.studio.getState().positions[entry.artifactId].x < 0);
    assert.ok(app.studio.getState().positions[entry.artifactId].y < 0);

    const canvasViewport = structuredClone(app.studio.getState().camera);
    scroll.dispatchEvent(
      new app.window.MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 50,
        clientY: 50,
      }),
    );
    scroll.dispatchEvent(
      new app.window.MouseEvent('pointermove', {
        bubbles: true,
        clientX: 170,
        clientY: 140,
      }),
    );
    scroll.dispatchEvent(new app.window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    assert.equal(app.studio.getState().camera.x, canvasViewport.x + 120);
    assert.equal(app.studio.getState().camera.y, canvasViewport.y + 90);
    const movedCanvasViewport = structuredClone(app.studio.getState().camera);

    app.studio.setView('prototype');
    assert.notDeepEqual(app.studio.getState().camera, movedCanvasViewport);
    app.studio.setView('canvas');
    assert.equal(app.studio.getState().camera.x, movedCanvasViewport.x);
    assert.equal(app.studio.getState().camera.y, movedCanvasViewport.y);
    assert.equal(app.studio.getState().viewports.canvas.x, movedCanvasViewport.x);
    assert.equal(app.studio.getState().viewports.canvas.y, movedCanvasViewport.y);
    assert.equal(app.studio.getState().viewports.canvas.zoom, app.studio.getState().zoom);

    const point = { x: 190, y: 140 };
    const beforeZoom = structuredClone(app.studio.getState());
    const worldPoint = {
      x: (point.x - beforeZoom.camera.x) / beforeZoom.zoom,
      y: (point.y - beforeZoom.camera.y) / beforeZoom.zoom,
    };
    scroll.dispatchEvent(
      new app.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -40,
        clientX: point.x,
        clientY: point.y,
      }),
    );
    const afterZoom = app.studio.getState();
    assert.ok(afterZoom.zoom > beforeZoom.zoom);
    assert.ok(Math.abs((point.x - afterZoom.camera.x) / afterZoom.zoom - worldPoint.x) < 1e-8);
    assert.ok(Math.abs((point.y - afterZoom.camera.y) / afterZoom.zoom - worldPoint.y) < 1e-8);
  } finally {
    app.close();
  }
});

test('screen guidance stays outside product frames in compact tooltips and an accordion', async () => {
  const app = await mount();
  try {
    assert.equal(app.documentNode.querySelectorAll('[data-design-notes]').length, 1);
    const note = app.documentNode.querySelector('[data-design-note="screen-2"]');
    assert.match(note.title, /Journey step 2/);
    note.click();
    const notes = app.documentNode.querySelector('[data-design-notes]');
    const target = app.documentNode.querySelector('[data-design-note-screen="screen-2"]');
    assert.equal(notes.open, true);
    assert.equal(target.open, true);
    assert.equal(target.dataset.active, 'true');
    assert.equal(
      app.documentNode.querySelectorAll('.planr-artifact-panel [data-design-note-screen]').length,
      0,
    );
  } finally {
    app.close();
  }
});

test('walkthroughs do not truncate beyond eight screens and reject unknown navigation', async () => {
  const app = await mount({ data: fixture({ count: 12 }) });
  try {
    app.studio.setView('walkthrough');
    for (let index = 1; index < 12; index += 1)
      app.documentNode.querySelector('[data-design-step-change="1"]').click();
    assert.equal(app.studio.getState().screenId, 'screen-12');
    assert.equal(app.documentNode.querySelector('[data-design-step]').textContent, 'Step 12 of 12');
    assert.equal(app.documentNode.querySelector('[data-design-step-change="1"]').disabled, true);
    assert.equal(app.studio.selectScreen('does-not-exist'), false);
    assert.equal(app.studio.getState().screenId, 'screen-12');
  } finally {
    app.close();
  }
});

test('the preview default is not a vote and the first direction can be explicitly selected', async () => {
  const saves = [];
  const app = await mount({
    options: {
      saveState: async (state) => {
        saves.push(state);
        return { stateVersion: saves.length };
      },
    },
  });
  try {
    const select = app.documentNode.querySelector('[data-design-select-direction]');
    assert.equal(select.disabled, false);
    assert.equal(select.textContent, 'Use this direction');
    assert.equal(
      app.documentNode.querySelector('[data-design-selected-direction]').textContent,
      '',
    );
    assert.deepEqual([...app.studio.getState().preferences.selected], []);
    select.click();
    await app.studio.flush();
    assert.deepEqual([...saves.at(-1).preferences.selected], ['editorial']);
    assert.equal(select.textContent, 'Selected direction');
    assert.equal(select.disabled, true);
  } finally {
    app.close();
  }
});

test('ratings, remix, selection and keyboard arrangement persist serially with optimistic state versions', async () => {
  const saves = [];
  const app = await mount({
    options: {
      saveState: async (state, context) => {
        saves.push({ state, context });
        return { stateVersion: saves.length };
      },
    },
  });
  try {
    const variant = app.documentNode.querySelector('[data-design-variant]');
    variant.value = 'compact';
    variant.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    app.documentNode.querySelector('[data-design-rating="4"]').click();
    app.documentNode.querySelector('[data-design-select-direction]').click();
    app.documentNode.querySelector('[data-design-remix]').value = 'Keep the compact navigation.';
    app.documentNode.querySelector('[data-design-save-remix]').click();
    const entry = app.entries.find(
      (item) =>
        item.variantId === 'compact' && item.screenId === 'screen-1' && item.frameId === 'desktop',
    );
    const label = app.documentNode.querySelector(`[data-design-drag="${entry.artifactId}"]`);
    label.dispatchEvent(
      new app.window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
      }),
    );
    await app.studio.flush();
    const state = saves.at(-1).state;
    assert.equal(state.ratings.compact, 4);
    assert.equal(state.selectedVariant, 'compact');
    assert.equal(state.remix.compact, 'Keep the compact navigation.');
    assert.equal(state.positions[entry.artifactId].x, 8);
    assert.equal(app.studio.getSaveState().dirty, false);
    app.documentNode.querySelector('[data-design-rating="5"]').click();
    await app.studio.flush();
    assert.equal(saves.at(-1).context.stateVersion, 1);
    assert.equal(saves.at(-1).state.ratings.compact, 5);
  } finally {
    app.close();
  }
});

test('save failure keeps an unsaved draft visible and never reports success', async () => {
  const app = await mount({
    options: {
      saveState: async () => {
        throw Object.assign(new Error('conflict'), { conflict: true });
      },
    },
  });
  try {
    app.documentNode.querySelector('[data-design-rating="2"]').click();
    await app.studio.flush();
    assert.equal(app.studio.getSaveState().dirty, true);
    assert.equal(
      app.documentNode.querySelector('[data-design-save-state]').textContent,
      'Save conflict',
    );
    const draft = JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork'));
    assert.equal(draft.unsaved, true);
    assert.equal(draft.state.ratings.editorial, 2);
    assert.match(app.documentNode.querySelector('.design-notice').textContent, /another window/);
  } finally {
    app.close();
  }
});

test('portable view defaults preserve saved browser ratings and arrangements on reopen', async () => {
  const data = fixture();
  const artifactId = data.entries[0].artifactId;
  const app = await mount({
    data: { ...data, state: { view: 'walkthrough' } },
    stored: {
      state: {
        view: 'prototype',
        selectedVariant: 'compact',
        ratings: { compact: 5 },
        positions: { [artifactId]: { x: 80, y: 120 } },
      },
    },
  });
  try {
    assert.equal(app.studio.getState().view, 'walkthrough');
    assert.equal(app.studio.getState().selectedVariant, 'compact');
    assert.equal(app.studio.getState().ratings.compact, 5);
    assert.equal(app.studio.getState().positions[artifactId].x, 80);
  } finally {
    app.close();
  }
});

test('pins remain owned by the artifact review controller across studio navigation', async () => {
  const app = await mount();
  try {
    const entry = app.entries.find(
      (item) =>
        item.screenId === 'screen-2' &&
        item.variantId === 'editorial' &&
        item.frameId === 'desktop',
    );
    app.stage.review.setIdentity({ name: 'Asem' });
    app.stage.review.dispatch({
      type: 'add-pin',
      pin: {
        artifactId: entry.artifactId,
        viewport: { width: 1280, height: 800 },
        region: { x: 0.2, y: 0.3, w: 0, h: 0 },
        intent: 'improve',
        comment: 'Increase the task hierarchy.',
      },
    });
    const before = app.stage.review.getState().review;
    app.studio.setView('prototype');
    app.studio.selectScreen('screen-2');
    app.studio.setView('walkthrough');
    assert.deepEqual(app.stage.review.getState().review, before);
    assert.equal(
      app.documentNode.querySelectorAll('.planr-annotation-layer [data-planr-pin-id]').length,
      1,
    );
    assert.equal(
      app.documentNode.querySelector('[data-design-rating="1"]').getAttribute('aria-pressed'),
      'false',
    );
  } finally {
    app.close();
  }
});

test('review experience preserves read-only modes, welcome context and personal sidebar widths', async () => {
  const value = await mount({
    experience: true,
    options: {
      loadExperience: async () => ({
        capabilities: { owner: false },
        reviewContext: {
          brief: {
            purpose: 'Check the assignment flow.',
            requests: ['Can you find the next action?'],
          },
          implementation: {
            tokens: [{ name: 'accent', value: '#008577' }],
            components: [],
            responsive: ['One column on mobile.'],
            accessibility: ['Labels remain visible.'],
          },
        },
      }),
    },
  });
  try {
    const { documentNode: document, window, studio } = value;
    assert.ok(window.__openPlanrDesignExperience);
    const separator = document.querySelector('[aria-label="Resize screens sidebar"]');
    separator.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    assert.equal(
      document.querySelector('.planr-shell').style.getPropertyValue('--design-nav-width'),
      '248px',
    );
    separator.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(separator.getAttribute('aria-valuenow'), '360');
    document.querySelector('#design-inspect-tab').click();
    assert.equal(document.querySelector('#design-review-panel').hidden, true);
    assert.equal(document.querySelector('#design-inspect-panel').hidden, false);
    assert.match(document.querySelector('#design-inspect-panel').textContent, /accent/);
    document
      .querySelector('#design-inspect-tab')
      .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(document.querySelector('#design-review-panel').hidden, false);
    window.__openPlanrDesignExperience.about();
    assert.match(document.querySelector('dialog').textContent, /Check the assignment flow/);
    assert.match(document.querySelector('dialog').textContent, /Can you find the next action/);
    [...document.querySelectorAll('dialog button')]
      .find((item) => item.textContent === 'Start walkthrough')
      .click();
    assert.equal(document.querySelector('dialog').dataset.designWelcomeStep, 'profile');
    [...document.querySelectorAll('dialog button')]
      .find((item) => item.textContent === 'Browse first')
      .click();
    assert.equal(studio.getState().view, 'walkthrough');
    assert.equal(studio.getState().screenId, 'screen-1');
    assert.equal(studio.getState().navOpen, false);
    assert.equal(document.querySelector('dialog'), null);
  } finally {
    value.close();
  }
});

test('review filters search and classify without losing unsent reply text', async () => {
  const value = await mount({
    experience: true,
    options: {
      loadExperience: async () => ({
        capabilities: { owner: false },
        metadata: { version: 1, categories: { 'pin-1': 'blocker' }, dispositions: {} },
      }),
    },
  });
  try {
    const { documentNode: document, stage, entries, envelope } = value;
    const { digestArtifactEnvelope } = await import('@openplanr/artifact/envelope.mjs');
    const pin = (id, screen, comment) => ({
      id,
      artifactId: entries.find((item) => item.screenId === screen).artifactId,
      author: { name: 'Rae' },
      intent: 'improve',
      status: 'open',
      comment,
      region: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
      viewport: { width: 1280, height: 800 },
      anchor: { planrId: 'main', screen },
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      replies: [],
    });
    stage.review.replaceReview({
      schemaVersion: '1.0.0',
      reviewId: 'review',
      reviewOf: digestArtifactEnvelope(envelope),
      decision: 'pending',
      overall: '',
      pins: [pin('pin-1', 'screen-1', 'Missing action'), pin('pin-2', 'screen-2', 'Looks clear')],
    });
    assert.equal(document.querySelectorAll('.planr-thread').length, 1);
    const reply = document.querySelector('[data-planr-reply-form] textarea');
    reply.value = 'Unsent detailed answer';
    reply.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    const scope = document.querySelector('[aria-label="Review scope"]');
    scope.value = 'all';
    scope.dispatchEvent(new value.window.Event('change', { bubbles: true }));
    assert.equal(document.querySelectorAll('.planr-thread').length, 2);
    assert.equal(
      document.querySelector('[data-planr-pin-id="pin-1"] textarea').value,
      'Unsent detailed answer',
    );
    const type = document.querySelector('[aria-label="Comment type"]');
    type.value = 'blocker';
    type.dispatchEvent(new value.window.Event('change', { bubbles: true }));
    assert.equal(document.querySelectorAll('.planr-thread').length, 1);
    assert.equal(document.querySelector('.planr-intent').textContent, 'Blocker');
    const search = document.querySelector('[aria-label="Search comments"]');
    search.value = 'nothing';
    search.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('.planr-thread').length, 0);
    search.value = 'action';
    search.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    assert.equal(
      document.querySelector('[data-planr-pin-id="pin-1"] textarea').value,
      'Unsent detailed answer',
    );
  } finally {
    value.close();
  }
});

test('owner handoff keeps source quotes immutable and requires saving refinements before approval', async () => {
  const calls = [];
  const source = {
    pinId: 'p1',
    reviewId: 'review',
    reviewOf: 'f'.repeat(64),
    text: 'The primary action is unclear.',
    refinement: '',
    author: 'Rae',
    source: 'local',
    stale: false,
  };
  let result = {
    current: true,
    metadata: { version: 0, categories: {}, dispositions: {} },
    revision: 'current',
    draft: {
      version: 1,
      status: 'draft',
      contentHash: 'hash-one',
      content: {
        summary: 'Clarify the action',
        agreedChanges: [source],
        openQuestions: [],
        deferred: [],
        rejected: [],
      },
      markdown: 'Review brief',
    },
  };
  const value = await mount({
    experience: true,
    options: {
      loadExperience: async () => ({
        revision: 'current',
        capabilities: { owner: true, handoff: true },
      }),
      loadHandoff: async () => result,
      updateHandoff: async (body) => {
        calls.push(body);
        result = {
          ...result,
          draft: {
            ...result.draft,
            version: 2,
            contentHash: 'hash-two',
            ...(body.content ? { content: body.content } : {}),
            status: body.action === 'approve' ? 'approved' : 'draft',
          },
        };
        return result;
      },
    },
  });
  try {
    const document = value.documentNode;
    value.window.__openPlanrDesignHandoffCenter.open('review');
    await delay(10);
    const reviewDecisions = [...document.querySelectorAll('.design-handoff-center button')].find(
      (button) => button.textContent === 'Review and approve decisions',
    );
    assert.ok(reviewDecisions, 'the Handoff Center review step opens the review handoff');
    reviewDecisions.click();
    await delay(10);
    assert.equal(document.querySelector('blockquote').textContent, source.text);
    const refinement = document.querySelector('[aria-label="Accepted changes: p1"]');
    refinement.value = 'Use a clear verb and keep the action above the fold.';
    refinement.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    const find = (label) =>
      [...document.querySelectorAll('dialog button')].find(
        (button) => button.textContent === label,
      );
    assert.equal(find('Approve handoff').disabled, true);
    find('Save draft').click();
    await delay(10);
    assert.equal(calls[0].content.agreedChanges[0].text, source.text);
    assert.equal(
      calls[0].content.agreedChanges[0].refinement,
      'Use a clear verb and keep the action above the fold.',
    );
    find('Approve handoff').click();
    await delay(10);
    assert.equal(calls[1].action, 'approve');
    assert.equal(calls[1].contentHash, 'hash-two');
    assert.equal(find('Approve handoff').disabled, true);
  } finally {
    value.close();
  }
});
