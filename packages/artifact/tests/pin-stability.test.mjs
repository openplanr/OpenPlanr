import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mountArtifactAnnotations } from '../lib/artifact/ui/annotations.mjs';

const { JSDOM } = createRequire(new URL('../../cli/package.json', import.meta.url))('jsdom');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const viewport = { width: 800, height: 600 };
const pin = (id) => ({
  id,
  artifactId: 'screen',
  variant: 'direction',
  anchor: { planrId: id },
  viewport,
  region: { x: 0.5, y: 0.5, w: 0, h: 0 },
  intent: 'question',
  status: 'open',
  comment: 'Check this',
});
const anchor = (id, x = 400) => ({
  planrId: id,
  viewport,
  rect: { x, y: 120, width: 160, height: 120 },
});
function fixture(t, count = 1) {
  const dom = new JSDOM(
    '<main class="planr-shell"><iframe data-planr-artifact-frame="screen"></iframe><div data-planr-annotation-layer="screen"></div></main>',
  );
  const { document } = dom.window,
    root = document.querySelector('main'),
    frame = document.querySelector('iframe');
  const review = {
    reviewOf: 'a'.repeat(64),
    pins: Array.from({ length: count }, (_, i) => pin('pin-' + i)),
  };
  const requests = [];
  let now = 0,
    tick;
  dom.window.performance.now = () => now;
  dom.window.setInterval = (callback) => {
    tick = callback;
    return 1;
  };
  dom.window.clearInterval = () => {};
  frame.__openPlanrBridge = {
    resolve(planrId) {
      return new Promise((resolve) => requests.push({ planrId, resolve }));
    },
  };
  const controller = mountArtifactAnnotations({
    root,
    document,
    window: dom.window,
    stageController: {
      getState: () => ({
        status: 'ready',
        artifacts: [{ id: 'screen', viewport }],
        activeArtifactId: 'screen',
        reviewMode: 'comment',
      }),
      dispatch() {},
    },
    reviewController: { getReview: () => review },
  });
  t.after(() => {
    controller.destroy();
    dom.window.close();
  });
  return {
    controller,
    review,
    frame,
    document,
    requests,
    tick() {
      now += 250;
      tick();
    },
  };
}

test('anchor refresh retains nodes, positions, focus and custom presentation until a valid result arrives', async (t) => {
  const f = fixture(t);
  await flush();
  const button = f.document.querySelector('.planr-pin');
  assert.equal(
    button.hidden,
    true,
    'Anchor-relative coordinates are never guessed as viewport geometry',
  );
  f.requests.shift().resolve(anchor('pin-0'));
  await flush();
  assert.equal(button.style.left, '60%');
  assert.equal(button.hidden, false);
  button.focus();
  button.dataset.designCategory = 'change';
  f.review.pins[0].comment = 'Reply arrived';
  f.controller.render();
  assert.equal(f.document.querySelector('.planr-pin'), button);
  assert.equal(f.document.activeElement, button);
  assert.equal(button.dataset.designCategory, 'change');
  f.tick();
  await flush();
  f.tick();
  f.controller.render();
  await flush();
  assert.equal(f.requests.length, 1, 'One anchor request per pin may be pending');
  assert.equal(button.style.left, '60%');
  assert.equal(button.hidden, false);
  f.requests.shift().resolve(anchor('pin-0', 480));
  await flush();
  assert.equal(button.style.left, '70%');
  f.tick();
  await flush();
  f.requests.shift().resolve(null);
  await flush();
  assert.equal(
    button.hidden,
    true,
    'A missing anchor never moves the pin onto unrelated product content',
  );
  assert.equal(button.dataset.planrAnchorStatus, 'unavailable');
  f.tick();
  await flush();
  f.requests.shift().resolve(anchor('pin-0', 520));
  await flush();
  assert.equal(button.hidden, false);
  assert.equal(button.style.left, '75%');
});

test('late anchor responses cannot move revised, removed or newly loaded pins', async (t) => {
  const f = fixture(t);
  await flush();
  const first = f.requests.shift();
  f.review.reviewOf = 'b'.repeat(64);
  f.review.pins[0].region.x = 0.25;
  f.controller.render();
  await flush();
  first.resolve(anchor('pin-0', 10));
  await flush();
  const button = f.document.querySelector('.planr-pin');
  assert.equal(button.hidden, true);
  f.requests.shift().resolve(anchor('pin-0'));
  await flush();
  assert.ok(Math.abs(parseFloat(button.style.left) - 55) < 0.00001);
  f.tick();
  await flush();
  const oldFrame = f.requests.shift();
  f.frame.__openPlanrBridge = {
    resolve(planrId) {
      return new Promise((resolve) => f.requests.push({ planrId, resolve }));
    },
  };
  oldFrame.resolve(anchor('pin-0', 10));
  await flush();
  assert.ok(
    Math.abs(parseFloat(button.style.left) - 55) < 0.00001,
    'A retired frame cannot update the active pin',
  );
  f.tick();
  await flush();
  const stale = f.requests.shift();
  f.review.pins = [];
  f.controller.render();
  stale.resolve(anchor('pin-0', 10));
  await flush();
  assert.equal(f.document.querySelectorAll('.planr-pin').length, 0);
});

test('large anchored reviews refresh fairly without flooding the authenticated bridge', async (t) => {
  const f = fixture(t, 80),
    visited = new Set();
  await flush();
  assert.equal(f.requests.length, 8);
  for (let batch = 0; batch < 10; batch++) {
    assert.ok(f.requests.length <= 8);
    const requests = f.requests.splice(0);
    for (const request of requests) {
      visited.add(request.planrId);
      request.resolve(anchor(request.planrId));
    }
    await flush();
    f.tick();
    await flush();
  }
  assert.equal(visited.size, 80);
  assert.equal(f.document.querySelectorAll('.planr-pin').length, 80);
  f.controller.destroy();
  for (const request of f.requests) request.resolve(anchor(request.planrId));
  await flush();
  assert.equal(f.document.querySelectorAll('.planr-pin').length, 0);
});
