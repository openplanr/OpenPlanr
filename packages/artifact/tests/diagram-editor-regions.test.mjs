import assert from 'node:assert/strict';
import test from 'node:test';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { createEditorCommands } from '../lib/artifact/ui/diagram-editor-commands.mjs';
import { colorSchemeOf, readHostOptions } from '../lib/artifact/ui/diagram-editor-host.mjs';
import { editorShortcut } from '../lib/artifact/ui/diagram-editor-keyboard.mjs';

const key = (value, modifiers = {}) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...modifiers,
});
const allowed = { selection: true, clipboard: true, editable: true };

test('editor shortcuts map keys to tools, commands and nudges', () => {
  assert.deepEqual(editorShortcut(key(' '), allowed), { type: 'temporary-pan' });
  assert.deepEqual(editorShortcut(key('V', { shiftKey: true }), allowed), {
    type: 'tool',
    tool: 'select',
  });
  assert.deepEqual(editorShortcut(key('h'), allowed), { type: 'tool', tool: 'pan' });
  assert.deepEqual(editorShortcut(key('s', { metaKey: true }), allowed), {
    type: 'command',
    action: 'save',
  });
  assert.deepEqual(editorShortcut(key('Z', { ctrlKey: true, shiftKey: true }), allowed), {
    type: 'command',
    action: 'redo',
  });
  assert.deepEqual(editorShortcut(key('z', { ctrlKey: true }), allowed), {
    type: 'command',
    action: 'undo',
  });
  assert.deepEqual(editorShortcut(key('Backspace'), allowed), {
    type: 'command',
    action: 'delete',
  });
  assert.deepEqual(editorShortcut(key('ArrowLeft', { shiftKey: true }), allowed), {
    type: 'nudge',
    dx: -10,
    dy: 0,
    delta: 10,
  });
  assert.deepEqual(editorShortcut(key('ArrowDown'), allowed), {
    type: 'nudge',
    dx: 0,
    dy: 1,
    delta: 1,
  });
  assert.equal(editorShortcut(key('q'), allowed), null);
});

test('editor shortcuts that edit need a selection, a clipboard or an editable diagram', () => {
  const none = { selection: false, clipboard: false, editable: false };
  assert.equal(editorShortcut(key('c', { metaKey: true }), none), null);
  assert.equal(editorShortcut(key('v', { metaKey: true }), none), null);
  assert.equal(editorShortcut(key('Delete'), { ...allowed, editable: false }), null);
  assert.equal(editorShortcut(key('ArrowUp'), { ...allowed, selection: false }), null);
  assert.deepEqual(editorShortcut(key('v'), none), { type: 'tool', tool: 'select' });
  assert.deepEqual(editorShortcut(key('s', { ctrlKey: true }), none), {
    type: 'command',
    action: 'save',
  });
});

test('host options are validated in a fixed order and filled with local defaults', () => {
  const config = readHostOptions({ labels: { subtitle: 'Company diagram' }, colorScheme: 'dark' });
  assert.equal(config.labels.subtitle, 'Company diagram');
  assert.equal(config.labels.readOnly, 'Read only');
  assert.deepEqual([config.actions, config.panels], [[], []]);
  assert.equal(config.reviewEnabled, true);
  assert.equal(config.colorScheme, 'dark');
  assert.equal(readHostOptions({ review: false }).reviewEnabled, false);
  assert.throws(
    () => readHostOptions({ review: 'yes', labels: { unknown: 'x' } }),
    /Host review must be true or false/,
  );
  assert.throws(() => readHostOptions({ labels: { unknown: 'x' } }), /Unknown host label: unknown/);
  assert.throws(
    () => readHostOptions({ panels: [{ id: 'review', label: 'Review', mount() {} }] }),
    /unique lowercase id; received "review"/,
  );
  assert.throws(
    () =>
      readHostOptions({
        actions: [{ id: 'share', label: 'Share', icon: 'rocket', onSelect() {} }],
      }),
    /unknown icon: rocket/,
  );
  assert.equal(colorSchemeOf(undefined), null);
  assert.throws(() => colorSchemeOf('sepia'), /received "sepia"/);
});

// A context whose regions only record what the command table asks of them.
function commandContext({ bundle = makeBundle(), selection = [], dirty = false } = {}) {
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  const state = {
    bundle,
    gesture: null,
    view: {
      selection,
      collapsedGroups: [],
      snap: false,
      camera: { x: 0, y: 0, scale: 1, fit: null },
    },
  };
  const session = {
    getState: () => state,
    submit(command) {
      calls.push(['submit', command.type]);
      return { ok: true };
    },
    setView(patch) {
      calls.push(['setView', Object.keys(patch)]);
      return { ok: true };
    },
  };
  const ctx = {
    doc: {},
    session,
    dom: {},
    config: { actions: [] },
    current: () => state,
    report: record('report'),
    notice: record('notice'),
    inspector: {
      dirty: () => dirty,
      guardDraft() {
        calls.push(['guardDraft']);
        return !dirty;
      },
    },
    canvas: { zoom: record('zoom'), fit: record('fit') },
    dialogs: { cancel: record('cancel'), openLayout: record('openLayout') },
  };
  return { commands: createEditorCommands(ctx), calls };
}

test('the command table routes each action to one handler and ignores unknown actions', () => {
  const { commands, calls } = commandContext();
  commands.act('zoom-in');
  commands.act('zoom-out');
  commands.act('fit');
  commands.act('lane-horizontal');
  commands.act('not-an-action');
  assert.deepEqual(calls, [
    ['zoom', 1.2],
    ['zoom', 1 / 1.2],
    ['fit'],
    ['openLayout', 'horizontal'],
  ]);
});

test('align and distribute actions resolve by prefix and report arrangement errors', () => {
  const selected = commandContext({ selection: ['node-a', 'node-b'] });
  selected.commands.act('align-left');
  assert.deepEqual(selected.calls, [
    ['submit', 'geometry'],
    ['report', ''],
  ]);
  const single = commandContext({ selection: ['node-a'] });
  single.commands.act('distribute-vertical');
  assert.deepEqual(single.calls, [['report', 'Select at least two shapes or containers.']]);
});

test('without a readable diagram only host actions and dialog cancel run', () => {
  const { commands, calls } = commandContext({ bundle: null });
  commands.act('zoom-in');
  commands.act('lock');
  commands.act('cancel-dialog');
  assert.deepEqual(
    calls.map(([name]) => name),
    ['cancel'],
  );
});

test('edits wait for unapplied properties to be applied or reverted', () => {
  const { commands, calls } = commandContext({ selection: ['node-a'], dirty: true });
  commands.act('lock');
  assert.deepEqual(calls, [['guardDraft']]);
  assert.deepEqual(commands.select(['node-b']), { ok: false, status: 'property-draft' });
});
