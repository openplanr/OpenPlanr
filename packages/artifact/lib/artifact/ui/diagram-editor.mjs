import { element, button, field, downloadJson } from './diagram-editor-dom.mjs';
import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import { renderDiagramProperties } from './diagram-editor-properties.mjs';
import { mountDiagramConflicts } from './diagram-conflicts.mjs';
import { mountDiagramSourcePanel } from './diagram-source-panel.mjs';
import { createObject, processTemplate, connector, freshId, placement, duplicateSelection, arrangementCommand, laneArrangementCommand, addOrthogonalDetour, moveOrthogonalBend, transaction, labelOf } from './diagram-editor-actions.mjs';
import { elementIndex, geometryFields, appearanceFields, membershipState, clone, snapshot } from '../diagram/authoring/model.mjs';
import { compileDiagramCommand } from '../diagram/authoring/index.mjs';
import { copyDiagramSelection } from '../diagram/editor/clipboard.mjs';
import { authoredDiagramPalette, renderAuthoredSceneElement } from '../diagram/authoring/renderer.mjs';
import { resolveDiagramSceneElement } from '../diagram/authoring/scene.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const MODELS = ['process', 'start', 'end', 'decision', 'data-store', 'component', 'annotation', 'container', 'horizontal-lane', 'vertical-lane'];
const ACTION_LABELS = { process: 'process', start: 'start', end: 'end', decision: 'decision', 'data-store': 'data store', component: 'component', annotation: 'annotation', container: 'container', 'horizontal-lane': 'horizontal lane', 'vertical-lane': 'vertical lane' };
const errText = result => result?.diagnostics?.map(item => item.detail).filter(Boolean).join(' ') || result?.message || 'The change could not be applied.';
const boundsOf = bundle => {
  const rects = bundle.presentation.elements.map(item => item.bounds).filter(Boolean);
  if (!rects.length) return { x: -200, y: -120, width: 400, height: 240 };
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) { x = Math.min(x, rect.x); y = Math.min(y, rect.y); right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height); }
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};
const safeAction = (fn, report) => { try { return fn(); } catch (error) { report(error instanceof Error ? error.message : 'The edit is invalid.'); return null; } };
const intersect = (a, b) => a && b && a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const focusable = element => element?.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"]');

/** Browser-safe, framework-neutral UI. The supplied session remains owned by its host. */
export function mountDiagramEditor({ root, session, host = {} }) {
  if (!root || !session || typeof session.getState !== 'function') throw new TypeError('Mount needs one root and one editor session.');
  const doc = root.ownerDocument, win = doc.defaultView;
  let disposed = false, raf = 0, drag = null, tempPan = false, tool = 'select', tab = 'outline', rightTab = 'properties';
  let leftOpen = true, rightOpen = true, clipboard = null, dialog = null, conflictMount = null, reviewCleanup = null;
  let sourceMount = null, sourceDraft = null, dialogReturnFocus = null;
  let elementNodes = new Map(), renderSignatures = new Map(), renderedDigest = '', lastCanvas = null, lastBreakpoint = null, mode = 'edit', lastAnnouncement = '';
  const shell = element(doc, 'div', { className: 'planr-diagram-editor' });
  shell.innerHTML = '<header class="de-bar"><div class="de-brand"><span class="de-mark" aria-hidden="true">◈</span><div class="de-identity"><strong class="de-title"></strong><small>Local diagram studio</small></div></div><span class="de-save-state" role="status" aria-live="polite"></span><div class="de-bar-actions"></div></header><div class="de-work"><aside class="de-left" aria-label="Diagram outline and shapes"><div class="de-rail-tabs" role="tablist" aria-label="Left panel"></div><div class="de-left-content"></div></aside><section class="de-stage"><div class="de-canvas" aria-label="Diagram canvas" role="application" tabindex="0"><svg data-editor-svg aria-label="Diagram drawing" role="img"><g data-world></g><g data-overlays></g></svg><div class="de-empty"></div><div class="de-canvas-tools"></div><div class="de-mobile-message">Review on mobile. Open on desktop to edit.</div></div><div class="de-stage-footer"></div></section><aside class="de-right" aria-label="Diagram properties and review"><div class="de-right-tabs" role="tablist" aria-label="Right panel"></div><div class="de-right-content"></div></aside></div><div class="de-alert" role="alert" hidden></div><div class="de-announcer" aria-live="polite" aria-atomic="true"></div><div class="de-dialog-layer"></div>';
  root.replaceChildren(shell);
  const $ = selector => shell.querySelector(selector);
  const bar = $('.de-bar-actions'), saveState = $('.de-save-state'), leftTabs = $('.de-rail-tabs'), leftBody = $('.de-left-content');
  const rightTabs = $('.de-right-tabs'), rightBody = $('.de-right-content'), stage = $('.de-canvas'), svg = $('[data-editor-svg]');
  const world = $('[data-world]'), overlays = $('[data-overlays]'), empty = $('.de-empty'), footer = $('.de-stage-footer');
  const alert = $('.de-alert'), announcer = $('.de-announcer'), dialogLayer = $('.de-dialog-layer');
  const createBar = (label, action, title = label) => { const node = button(doc, label, action, { title }); bar.append(node); return node; };
  createBar('Outline', 'outline', 'Show or hide outline');
  createBar('Undo', 'undo', 'Undo · Ctrl or Command Z');
  createBar('Redo', 'redo', 'Redo · Ctrl or Command Shift Z');
  createBar('Layout', 'layout');
  createBar('Save diagram', 'save', 'Save diagram · Ctrl or Command S').classList.add('de-primary');
  createBar('Properties', 'properties', 'Show or hide properties');
  createBar('Source', 'source-panel', 'Import or export a Mermaid copy');
  createBar('More', 'more');
  const canvasButton = (label, action) => { const node = button(doc, label, action); $('.de-canvas-tools').append(node); return node; };
  canvasButton('Select', 'select-tool'); canvasButton('Pan', 'pan-tool'); canvasButton('Snap', 'snap');
  canvasButton('−', 'zoom-out').setAttribute('aria-label', 'Zoom out');
  canvasButton('+', 'zoom-in').setAttribute('aria-label', 'Zoom in');
  canvasButton('Fit', 'fit');
  const notice = message => { if (message === lastAnnouncement) return; lastAnnouncement = message; announcer.textContent = message; };
  const report = message => { alert.hidden = !message; alert.textContent = message || ''; if (message) notice(message); };
  const editable = state => mode === 'edit' && win.innerWidth >= 700 && state.capabilities.read && state.capabilities.write && state.saveState !== 'access-changed' && !!getDiagramAuthoringCapability(state.bundle?.document.grammar.id);
  const current = () => session.getState();
  const displayed = state => state.gesture?.bundle ?? state.bundle;
  const select = ids => { const result = session.setView({ selection: [...new Set(ids)] }); if (!result.ok) report(errText(result)); else notice(ids.length ? ids.length + ' object' + (ids.length === 1 ? '' : 's') + ' selected.' : 'Selection cleared.'); return result; };
  const submit = (command, selectIds) => {
    const result = session.submit(command);
    if (!result.ok) { report(errText(result)); return result; }
    report('');
    if (selectIds?.length) select(selectIds);
    return result;
  };
  const submitTransaction = value => {
    const result = session.submitTransaction(value);
    if (!result.ok) report(errText(result)); else report('');
    return result;
  };
  const fromClient = event => { const rect = svg.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const worldPoint = (point, camera = current().view.camera) => ({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale });
  const cameraPatch = camera => session.setView({ camera });
  function fit() {
    const state = current(); if (!state.bundle) return;
    const rect = stage.getBoundingClientRect(), bounds = boundsOf(state.bundle), pad = 72;
    const scale = Math.min(1.6, Math.max(.04, Math.min((rect.width - pad * 2) / bounds.width, (rect.height - pad * 2) / bounds.height)));
    cameraPatch({ x: (rect.width - bounds.width * scale) / 2 - bounds.x * scale, y: (rect.height - bounds.height * scale) / 2 - bounds.y * scale, scale, fit: 'all' });
  }
  function zoom(factor, around) {
    const camera = current().view.camera, point = around ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const scale = Math.min(4, Math.max(.04, camera.scale * factor)), anchor = worldPoint(point, camera);
    cameraPatch({ x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale, fit: null });
  }
  function draw(event = { type: 'initial', affectedIds: [] }) {
    if (disposed) return;
    const state = current(), bundle = displayed(state);
    if (!bundle) { world.replaceChildren(); elementNodes.clear(); renderChrome(state); return; }
    const camera = state.view.camera;
    world.setAttribute('transform', 'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')');
    overlays.setAttribute('transform', world.getAttribute('transform'));
    const byId = elementIndex(bundle.document), placements = new Map(bundle.presentation.elements.map(entry => [entry.elementId, entry]));
    const palette = authoredDiagramPalette(bundle.presentation.theme.themeId), emphasis = new Map(bundle.document.emphasis.map(entry => [entry.targetId, entry.level]));
    const selection = new Set(state.view.selection);
    const forceAll = event.type === 'initial' || !elementNodes.size || renderedDigest === '' || event.type === 'refresh';
    const affected = forceAll ? new Set(placements.keys()) : new Set(event.affectedIds ?? []);
    if (event.type === 'content' && !affected.size) for (const id of placements.keys()) affected.add(id);
    const parser = new win.DOMParser();
    for (const [id, node] of elementNodes) if (!placements.has(id)) { node.remove(); elementNodes.delete(id); renderSignatures.delete(id); }
    for (let order = 0; order < bundle.presentation.elements.length; order++) {
      const entry = bundle.presentation.elements[order], id = entry.elementId;
      const source = byId.get(id);
      const signature = JSON.stringify([source, entry, emphasis.get(id) ?? null, bundle.presentation.theme.themeId,
        source?.collection === 'relations' ? [placements.get(source.value.from), placements.get(source.value.to)] : null]);
      if (!elementNodes.has(id) || ((affected.has(id) || forceAll) && renderSignatures.get(id) !== signature)) {
        const scene = resolveDiagramSceneElement(byId.get(id), entry, placements, order, emphasis.get(id) ?? null);
        const xml = parser.parseFromString('<svg xmlns="' + SVG + '">' + renderAuthoredSceneElement(scene, palette, bundle.diagramId) + '</svg>', 'image/svg+xml');
        const replacement = doc.importNode(xml.documentElement.firstElementChild, true);
        replacement.setAttribute('tabindex', '-1'); replacement.setAttribute('role', 'img'); replacement.setAttribute('aria-label', scene.label || scene.kind);
        const old = elementNodes.get(id); if (old) old.replaceWith(replacement); else world.append(replacement);
        elementNodes.set(id, replacement); renderSignatures.set(id, signature);
      }
      const node = elementNodes.get(id); node.dataset.selected = String(selection.has(id)); node.classList.toggle('de-selected', selection.has(id));
    }
    // Keep stable primitives; reordering moves only nodes whose source order changed.
    if (event.type === 'content' || event.type === 'refresh' || forceAll) {
      const ordered = [...bundle.presentation.elements].sort((a,b) => a.zIndex - b.zIndex || bundle.presentation.elements.indexOf(a) - bundle.presentation.elements.indexOf(b));
      for (const entry of ordered) world.append(elementNodes.get(entry.elementId));
    }
    renderedDigest = bundle.bundleDigest;
    shell.dataset.diagramTheme = bundle.presentation.theme.themeId;
    renderOverlays(state, bundle, selection);
    renderChrome(state);
  }
  function renderOverlays(state, bundle, selection) {
    overlays.replaceChildren();
    const scale = state.view.camera.scale, byPlacement = new Map(bundle.presentation.elements.map(item => [item.elementId, item]));
    for (const id of selection) {
      const geometry = session.geometry(id), rect = geometry?.bounds ?? geometry?.labelBounds;
      if (rect) {
        const box = doc.createElementNS(SVG, 'rect');
        for (const [key,value] of Object.entries({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) box.setAttribute(key, String(value));
        box.setAttribute('class','de-selection-box'); box.setAttribute('stroke-width',String(1.5 / scale)); box.setAttribute('pointer-events','none'); overlays.append(box);
        if (selection.size === 1 && editable(state) && byPlacement.get(id)?.bounds && !byPlacement.get(id).locks.size) {
          const handle = doc.createElementNS(SVG,'rect'); const size = 10 / scale;
          handle.setAttribute('x', String(rect.x + rect.width - size/2)); handle.setAttribute('y', String(rect.y + rect.height - size/2));
          handle.setAttribute('width',String(size)); handle.setAttribute('height',String(size)); handle.setAttribute('rx',String(2/scale));
          handle.setAttribute('class','de-resize-handle');handle.setAttribute('data-handle','resize');handle.setAttribute('data-handle-id',id);overlays.append(handle);
        }
      }
      if (geometry?.points?.length && editable(state)) for (let index = 1; index < geometry.points.length - 1; index++) {
        const point = geometry.points[index], handle = doc.createElementNS(SVG,'circle');
        handle.setAttribute('cx',String(point.x));handle.setAttribute('cy',String(point.y));handle.setAttribute('r',String(5/scale));
        handle.setAttribute('class','de-bend-handle');handle.setAttribute('data-handle','bend');handle.setAttribute('data-index',String(index));handle.setAttribute('data-handle-id',id);overlays.append(handle);
      }
    }
    if (drag?.type === 'marquee') {
      const a = worldPoint(drag.start), b = worldPoint(drag.last), rect = doc.createElementNS(SVG,'rect');
      rect.setAttribute('x',String(Math.min(a.x,b.x)));rect.setAttribute('y',String(Math.min(a.y,b.y)));
      rect.setAttribute('width',String(Math.abs(a.x-b.x)));rect.setAttribute('height',String(Math.abs(a.y-b.y)));
      rect.setAttribute('class','de-marquee');rect.setAttribute('stroke-width',String(1/scale));overlays.append(rect);
    }
  }
  let controlsStamp = '';
  function renderChrome(state) {
    const bundle = state.bundle;
    $('.de-title').textContent = bundle?.document.title ?? 'Diagram unavailable';
    const status = state.saveState;
    saveState.textContent = ({ saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved', offline: 'Offline · Unsaved', conflict: 'Conflict · Unsaved', 'access-changed': 'Access changed' })[status] ?? 'Unsaved';
    saveState.dataset.state = status;
    shell.dataset.editable = String(editable(state)); shell.dataset.mode = mode;
    shell.dataset.leftOpen = String(leftOpen); shell.dataset.rightOpen = String(rightOpen);
    for (const [action,disabled] of Object.entries({ undo: !state.canUndo || !editable(state), redo: !state.canRedo || !editable(state),
      save: !editable(state) || status === 'saving' || (status === 'saved' && state.pendingCount === 0 && !state.needsInitialization),
      layout: !editable(state), properties: !state.capabilities.read, outline: !state.capabilities.read, 'source-panel': !state.capabilities.read })) {
      const control = bar.querySelector('[data-action="' + action + '"]'); if (control) control.disabled = disabled;
    }
    const stamp = [bundle?.bundleDigest, state.view.selection.join('|'), state.view.collapsedGroups.join('|'), state.pendingCount,
      state.saveState, state.recovery.mode, tab, rightTab, mode, leftOpen, rightOpen, win.innerWidth < 700].join(':');
    if (stamp === controlsStamp) return;
    controlsStamp = stamp;
    renderLeft(state);
    renderRight(state);
    renderFooter(state);
    const hasContent = bundle && bundle.presentation.elements.length > 0;
    empty.hidden = hasContent || !editable(state);
    if (!empty.hidden) {
      empty.replaceChildren(element(doc,'h2',{},'Create your diagram'),element(doc,'p',{},'Add a shape or start with a small process flow. Everything stays local until you save.'));
      empty.append(button(doc,'Start blank','blank',{className:'de-primary'}),button(doc,'Use process template','template'));
      const guide = element(doc,'ol'); for (const step of ['Add shapes and connectors','Edit labels and layout','Save the diagram']) guide.append(element(doc,'li',{},step)); empty.append(guide);
    }
  }
  function renderLeft(state) {
    leftTabs.replaceChildren();
    if (win.innerWidth <= 1100) leftTabs.append(button(doc,'Close outline','close-outline',{className:'de-close-rail'}));
    for (const [name, action] of [['Outline','outline-tab'],['Shapes','shapes-tab']]) {
      const item = button(doc,name,action,{role:'tab','aria-selected':String(tab === name.toLowerCase())});
      leftTabs.append(item);
    }
    leftBody.replaceChildren();
    if (!state.bundle) return;
    if (tab === 'shapes') {
      leftBody.append(element(doc,'h2',{},'Shape library'),element(doc,'p',{className:'de-muted'},'Choose a shape, then edit its meaning and position.'));
      const capability=getDiagramAuthoringCapability(state.bundle.document.grammar.id);
      for (const kind of MODELS) {
        const primitive=kind==='annotation'?'annotation':kind==='container'?'group':kind.endsWith('-lane')?'lane':'node';
        if(capability&&!capability.primitives.includes(primitive))continue;
        if(capability&&primitive==='node'&&!capability.nodeKinds.includes(kind))continue;
        leftBody.append(button(doc,'Create ' + ACTION_LABELS[kind],'create',{ 'data-kind':kind,className:'de-shape-button',disabled:!editable(state) }));
      }
      return;
    }
    const search = field(doc,'Find in diagram','',{type:'search',placeholder:'Search objects'});leftBody.append(search.label);
    const list = element(doc,'div',{className:'de-outline-list',role:'tree','aria-label':'Diagram objects'});
    leftBody.append(list);
    const indexed = elementIndex(state.bundle.document), parents = new Set([...state.bundle.document.groups,...state.bundle.document.lanes].flatMap(value=>value.members));
    const expanded = new Set(state.view.collapsedGroups);
    function itemFor(id,depth=0) {
      const entry=indexed.get(id);if(!entry)return;
      const wrapper=element(doc,'div',{className:'de-outline-item','data-search-text':labelOf(entry.value).toLowerCase()});
      const choose=button(doc,labelOf(entry.value),'select-id',{role:'treeitem','data-id':id,'aria-selected':String(state.view.selection.includes(id)),style:'padding-inline-start:'+String(12+depth*14)+'px'});
      wrapper.append(choose);list.append(wrapper);
      if (entry.value.members?.length && !expanded.has(id)) for(const child of entry.value.members)itemFor(child,depth+1);
    }
    for (const id of state.bundle.document.accessibility.readingOrder) if (indexed.has(id)&&!parents.has(id)) itemFor(id);
    for (const [id] of indexed) if (!parents.has(id) && !list.querySelector('[data-id="' + id + '"]')) itemFor(id);
    search.input.addEventListener('input',()=>{
      const query=search.input.value.toLowerCase().trim();
      for(const row of list.querySelectorAll('.de-outline-item')) row.hidden=!!query&&!row.dataset.searchText.includes(query);
    });
    if (!indexed.size) leftBody.append(element(doc,'p',{className:'de-muted'},'No objects yet. Use Shapes to create one.'));
  }
  function renderRight(state) {
    rightTabs.replaceChildren();
    if (win.innerWidth <= 1100) rightTabs.append(button(doc,'Close properties','close-properties',{className:'de-close-rail'}));
    for(const [name,action] of [['Properties','properties-tab'],['Review','review-tab']])rightTabs.append(button(doc,name,action,{role:'tab','aria-selected':String(rightTab===name.toLowerCase())}));
    rightBody.replaceChildren();
    if (!state.bundle) { rightBody.append(element(doc,'p',{},'Access changed. Reopen this diagram.')); return; }
    if (rightTab === 'review') {
      rightBody.append(element(doc,'h2',{},'Review'));
      if (typeof host.mountReview === 'function') {
        const slot=element(doc,'div');rightBody.append(slot);
        reviewCleanup?.();reviewCleanup=host.mountReview({root:slot,session,select}) ?? null;
      } else rightBody.append(element(doc,'p',{className:'de-muted'},'Review comments are available after this diagram is published to a review workspace. Local editing does not publish it.'));
      return;
    }
    reviewCleanup?.();reviewCleanup=null;
    const focused = doc.activeElement?.getAttribute('aria-label');
    renderDiagramProperties({root:rightBody,state,editable:editable(state),act,submitTransaction});
    if (focused && rightBody.contains(doc.activeElement) === false && ['Apply properties'].includes(focused)) rightBody.querySelector('[aria-label="' + focused + '"]')?.focus();
  }
  function renderFooter(state) {
    footer.replaceChildren();
    if (state.saveState === 'conflict') footer.append(element(doc,'span',{},'A newer saved revision exists. Your draft remains in this tab.'),button(doc,'Compare revisions','conflict',{className:'de-primary'}));
    else if (state.saveState === 'offline') footer.append(element(doc,'span',{},'Save was not confirmed. Edits remain pending.'),button(doc,'Retry save','save'));
    else if (state.recovery.warning) footer.append(element(doc,'span',{},state.recovery.warning));
    else if (state.pendingCount > 0 && state.acknowledged) footer.append(element(doc,'span',{},'Recovered or pending edits are in this session. Review before you save.'));
    else if(!getDiagramAuthoringCapability(state.bundle.document.grammar.id))footer.append(element(doc,'span',{},'This diagram grammar is available for inspection only. Editing is not certified.'));
    else footer.append(element(doc,'span',{},state.view.selection.length + ' selected · ' + state.bundle.presentation.elements.length + ' objects'));
  }
  function closeDialog() {
    if (!dialog) return;
    if (sourceMount) { sourceDraft = sourceMount.getSource(); sourceMount.dispose(); sourceMount = null; }
    dialog.remove(); dialog = null; dialogLayer.replaceChildren();
    const target = dialogReturnFocus?.isConnected ? dialogReturnFocus : stage;
    dialogReturnFocus = null; target.focus();
  }
  function openDialog(name, content) {
    const returnTo = dialog ? dialogReturnFocus : doc.activeElement;
    closeDialog(); dialogReturnFocus = returnTo;
    const panel=element(doc,'section',{role:'dialog','aria-modal':'true','aria-label':name,className:'de-dialog'});
    panel.append(element(doc,'h2',{},name)); if(content)panel.append(content);
    dialogLayer.append(panel);dialog=panel;panel.querySelector('button,input,select')?.focus();return panel;
  }
  function askDelete() {
    const state=current(), ids=state.view.selection;if(!ids.length)return;
    const preview=compileDiagramCommand(state.bundle,{type:'delete',ids},{transactionId:freshId()});
    const impact=preview.deletionImpact;
    if(!impact){report(errText(preview));return;}
    const body=element(doc,'div');body.append(element(doc,'p',{},'Delete ' + impact.elementIds.length + ' object(s), including ' + impact.relationIds.length + ' connector(s)? This can be undone before another conflicting change.'));
    if(impact.relationIds.length)body.append(element(doc,'p',{className:'de-muted'},'Connectors: '+impact.relationIds.join(', ')));
    body.append(button(doc,'Cancel','cancel-dialog'),button(doc,'Delete','confirm-delete',{className:'de-danger'}));
    openDialog('Delete selection',body).dataset.impact=JSON.stringify(impact);
  }
  function connectDialog() {
    const state=current(),nodes=state.bundle.document.nodes;
    if(nodes.length<2){report('Create at least two nodes to connect.');return;}
    const body=element(doc,'div'),ids=state.view.selection;
    const from=field(doc,'From',ids.find(id=>nodes.some(node=>node.id===id))??nodes[0].id,{choices:nodes.map(node=>[node.id,node.label])});
    const to=field(doc,'To',ids.find(id=>nodes.some(node=>node.id===id&&node.id!==from.input.value))??nodes.at(-1).id,{choices:nodes.map(node=>[node.id,node.label])});
    const label=field(doc,'Connector label','');
    body.append(from.label,to.label,label.label,button(doc,'Cancel','cancel-dialog'),button(doc,'Create connector','confirm-connect',{className:'de-primary'}));
    openDialog('Connect objects',body);
  }
  function layoutDialog(lane = null) {
    const state=current(),body=element(doc,'div');
    body.append(element(doc,'p',{},'Preview the arrangement before applying. No changes are saved during preview.'));
    if(!lane){const scope=field(doc,'Arrange','selection',{choices:[['selection','Selection'],['all','Whole diagram']]});body.append(scope.label);}
    if(lane)body.append(element(doc,'p',{},'Arrange direct members within this lane. Container geometry changes only when you apply.'));
    body.append(button(doc,'Cancel layout','cancel-layout'),button(doc,'Preview layout','preview-layout',{className:'de-primary'}));
    const panel=openDialog('Layout preview',body);if(lane)panel.dataset.lane=lane;
  }
  function moreDialog() {
    const state=current(),body=element(doc,'div');
    body.append(element(doc,'p',{},'Import a new Mermaid copy or export the complete editable bundle. Source links are not available in this release.'));
    body.append(button(doc,'Import or export','source-panel'),button(doc,'Show source','show-source'),button(doc,'Show revision','show-revision'),button(doc,'Export JSON','export-json'),button(doc,'Close','cancel-dialog'));
    openDialog('Diagram options',body);
  }
  async function save() {
    const state=current();if(state.saveState==='conflict'){act('conflict');return;}
    const result=await session.save();
    if(disposed)return;
    if(!result.ok) {
      report(errText(result));
      if(result.status==='conflict'&&host.readCurrent){
        try { const authoritative=await host.readCurrent(); const compared=session.refresh(authoritative);if(!compared.ok&&current().comparison)act('conflict'); }
        catch(error){report(error instanceof Error?error.message:'Could not read current revision. Pending edits remain.');}
      }
    } else {report('');notice('Diagram saved.');}
  }
  function lockedSelection(bundle,ids,next) {
    const changes=ids.map(id=>bundle.presentation.elements.find(item=>item.elementId===id)).filter(Boolean).map(item=>{
      const before=appearanceFields(item),after=clone(before);
      if(item.bounds){after.locks.position=next;after.locks.size=next;}
      if(item.route)after.locks.route=next;
      return {elementId:item.elementId,before,after};
    });
    return {type:'appearance',changes};
  }
  function act(action,value,options={}) {
    const state=current(),bundle=state.bundle,ids=state.view.selection;
    if(!bundle && action!=='cancel-dialog')return;
    if(action==='save')return void save();
    if(action==='undo'){const result=session.undo();if(!result.ok)report(errText(result));return;}
    if(action==='redo'){const result=session.redo();if(!result.ok)report(errText(result));return;}
    if(action==='outline'||action==='close-outline'){leftOpen=action==='outline'?!leftOpen:false;controlsStamp='';renderChrome(current());if(leftOpen)leftTabs.querySelector('[data-action=outline-tab]')?.focus();else bar.querySelector('[data-action=outline]')?.focus();return;}
    if(action==='properties'||action==='close-properties'){rightOpen=action==='properties'?!rightOpen:false;controlsStamp='';renderChrome(current());if(rightOpen)rightTabs.querySelector('[data-action=properties-tab]')?.focus();else bar.querySelector('[data-action=properties]')?.focus();return;}
    if(action==='outline-tab'||action==='shapes-tab'){tab=action==='outline-tab'?'outline':'shapes';controlsStamp='';renderChrome(state);return;}
    if(action==='properties-tab'||action==='review-tab'){rightTab=action==='properties-tab'?'properties':'review';controlsStamp='';renderChrome(state);return;}
    if(action==='select-tool'||action==='pan-tool'){tool=action==='select-tool'?'select':'pan';notice(tool==='select'?'Select mode':'Pan mode');return;}
    if(action==='snap'){session.setView({snap:!state.view.snap});notice(state.view.snap?'Snap off':'Snap on');return;}
    if(action==='fit'){fit();return;}
    if(action==='zoom-in'){zoom(1.2);return;}if(action==='zoom-out'){zoom(1/1.2);return;}
    if(action==='more'){moreDialog();return;}
    if(action==='source-panel') {
      const slot = element(doc, 'div');
      openDialog('Mermaid copy and exports', slot).classList.add('de-source-dialog');
      sourceMount = mountDiagramSourcePanel({ root: slot, session, source: sourceDraft ?? current().bundle?.originalSource?.text ?? '',
        onSourceChange: value => { sourceDraft = value; },
        onAdopt: () => { closeDialog(); notice('Mermaid copy adopted. Save diagram to keep it.'); fit(); },
        onClose: closeDialog, onReport: report });
      sourceMount.focus(); return;
    }
    if(action==='show-source'||action==='show-revision'){
      dialog.replaceChildren(element(doc,'h2',{},action==='show-source'?'Source':'Current revision'));
      const pre=element(doc,'pre',{className:'de-source-view'},JSON.stringify(action==='show-source'?{originalSource:bundle.originalSource,sourceMap:bundle.sourceMap}:snapshot(bundle),null,2));
      dialog.append(pre,button(doc,'Close','cancel-dialog'));return;
    }
    if(action==='export-json'){downloadJson(doc,bundle,bundle.diagramId+'.planr-diagram-bundle.json');return;}
    if(action==='cancel-dialog'){if(state.gesture)session.cancelGesture('cancel-dialog');closeDialog();return;}
    if(action==='conflict'){
      const wrap=element(doc,'div');openDialog('Compare revisions',wrap);
      conflictMount?.dispose();conflictMount=mountDiagramConflicts({root:wrap,session,onClose:closeDialog,onError:result=>report(errText(result))});
      return;
    }
    if(action==='layout'){layoutDialog();return;}
    if(action==='lane-horizontal'||action==='lane-vertical'){layoutDialog(action==='lane-horizontal'?'horizontal':'vertical');return;}
    if(action==='preview-layout'){
      if(state.gesture)session.cancelGesture('new-layout');
      const start=session.beginGesture();if(!start.ok){report(errText(start));return;}
      let preview;
      if(dialog.dataset.lane){
        const laneId=ids[0],direction=dialog.dataset.lane;
        preview=safeAction(()=>session.previewGesture(laneArrangementCommand(bundle,laneId,direction)),report);
      }else{
        const scope=dialog.querySelector('[aria-label="Arrange"]').value;
        const targets=(scope==='all'?bundle.presentation.elements.map(item=>item.elementId):ids).filter(id=>!bundle.document.relations.some(relation=>relation.id===id));
        preview=session.previewLayout({targetIds:targets.slice(0,256)});
      }
      if(!preview?.ok){if(preview)report(errText(preview));session.cancelGesture('invalid-layout');return;}
      dialog.querySelector('[data-action="preview-layout"]').replaceWith(button(doc,'Apply layout','apply-layout',{className:'de-primary'}));
      dialog.append(element(doc,'p',{className:'de-muted'},'Preview only · No changes saved. Apply as one undoable edit.'));
      return;
    }
    if(action==='apply-layout'){const result=session.completeGesture();if(!result.ok)report(errText(result));else{closeDialog();notice('Layout applied as one edit. Save to keep it.');}return;}
    if(action==='cancel-layout'){session.cancelGesture('cancel-layout');closeDialog();return;}
    if(action==='blank'){empty.hidden=true;tab='shapes';controlsStamp='';renderChrome(state);return;}
    if(action==='template'){
      const at=worldPoint({x:stage.clientWidth/2-200,y:stage.clientHeight/2});
      const command=processTemplate({x:Math.round(at.x),y:Math.round(at.y)});
      submit(command,command.elements.filter(item=>item.collection==='nodes').map(item=>item.value.id));fit();return;
    }
    if(action==='create'){
      const kind=value,at=worldPoint({x:stage.clientWidth/2,y:stage.clientHeight/2});
      const existing=bundle.presentation.elements.map(item=>item.bounds).filter(Boolean);
      const right=existing.length?Math.max(...existing.map(item=>item.x+item.width)):null;
      const y=existing.length?Math.min(...existing.map(item=>item.y)):Math.round(at.y-36);
      const command=createObject(kind,{x:right===null?Math.round(at.x-80):Math.round(right+64),y:Math.round(y)});
      const result=submit(command,[command.elements[0].value.id]);if(result.ok&&state.view.camera.fit)fit();stage.focus();return;
    }
    if(action==='select-id'||action==='select-member'){
      const selected=options.additive?(ids.includes(value)?ids.filter(id=>id!==value):[...ids,value]):[value];
      select(selected);
      const outlineItem=options.fromOutline?[...leftBody.querySelectorAll('[data-action="select-id"]')].find(item=>item.dataset.id===value):null;
      (outlineItem??stage).focus();
      return;
    }
    if(action==='connect'){connectDialog();return;}
    if(action==='confirm-connect'){
      const from=dialog.querySelector('[aria-label="From"]').value,to=dialog.querySelector('[aria-label="To"]').value,label=dialog.querySelector('[aria-label="Connector label"]').value;
      const command=connector(from,to,label);const result=submit(command,[command.elements[0].value.id]);if(result.ok)closeDialog();return;
    }
    if(action==='delete'){askDelete();return;}
    if(action==='confirm-delete'){const impact=JSON.parse(dialog.dataset.impact);const result=submit({type:'delete',ids,confirmedImpact:impact});if(result.ok){select([]);closeDialog();}return;}
    if(action==='update-title'){
      const before={title:bundle.document.title,summary:bundle.document.summary,audience:bundle.document.audience,accessibility:bundle.document.accessibility};
      const after=clone(before);after.title=value;after.accessibility.title=value;
      submitTransaction(transaction(bundle,[{type:'update-semantics',collection:'document',before,after}]));return;
    }
    if(action==='copy'){const copied=copyDiagramSelection(bundle,ids);if(!copied.ok)report(errText(copied));else{clipboard=copied.value;notice('Selection copied.');}return;}
    if(action==='paste'||action==='duplicate'){
      const result=duplicateSelection(bundle,action==='paste'?(clipboard?.ids??[]):ids,action==='paste'?clipboard:null);
      if(!result?.ok){report(errText(result));return;}
      const submitted=submitTransaction(result.transaction);if(submitted.ok)select(result.selectedIds);return;
    }
    if(action==='lock'||action==='unlock'){submit(lockedSelection(bundle,ids,action==='lock'));return;}
    if(action.startsWith('align-')||action.startsWith('distribute-')){
      const command=safeAction(()=>arrangementCommand(bundle,ids,action),report);
      if(command)submit(command);return;
    }
    if(action==='group'){
      const selected=ids.map(id=>bundle.presentation.elements.find(item=>item.elementId===id)?.bounds).filter(Boolean);
      if(selected.length<2){report('Select at least two bounded objects to group.');return;}
      const x=Math.min(...selected.map(item=>item.x))-20,y=Math.min(...selected.map(item=>item.y))-40;
      const width=Math.max(...selected.map(item=>item.x+item.width))-x+20,height=Math.max(...selected.map(item=>item.y+item.height))-y+20;
      const id=freshId('group');submit({type:'group',group:{id,label:'Group'},ids,placement:placement(id,'container',{x,y,width,height})},[id]);return;
    }
    if(action==='ungroup'){submit({type:'ungroup',ids});return;}
    if(action==='reparent'){submit({type:'reparent',ids,parentId:value});return;}
    if(action==='lane-up'||action==='lane-down'){
      const order=[...bundle.document.laneOrder],index=order.indexOf(ids[0]),delta=action==='lane-up'?-1:1;
      if(index<0||index+delta<0||index+delta>=order.length)return;
      [order[index],order[index+delta]]=[order[index+delta],order[index]];submit({type:'reorder-lanes',ids:order});return;
    }
    if(action==='collapse'){const collapsed=new Set(state.view.collapsedGroups);if(collapsed.has(ids[0]))collapsed.delete(ids[0]);else collapsed.add(ids[0]);session.setView({collapsedGroups:[...collapsed]});return;}
    if(['add-bend','remove-bend','reset-route','position-label'].includes(action)){
      const id=ids[0],place=bundle.presentation.elements.find(item=>item.elementId===id),before=geometryFields(place),after=clone(before);
      const points=session.geometry(id)?.points??[];
      if(action==='reset-route'){after.route.mode='automatic';after.route.points=[];}
      if(action==='add-bend'){
        const bent=safeAction(()=>addOrthogonalDetour(points),report);
        if(!bent)return;
        after.route.mode='manual';after.route.strategy='orthogonal';after.route.points=bent;
      }
      if(action==='remove-bend'){
        after.route.points.splice(Number(value)+1,1);
        if(after.route.points.some((point,index,all)=>index>0&&point.x!==all[index-1].x&&point.y!==all[index-1].y)){
          report('This corner joins perpendicular segments. Move adjacent bends or reset the route.');return;
        }
        if(after.route.points.length===2){after.route.mode='automatic';after.route.points=[];}
      }
      if(action==='position-label'){const middle=points[Math.floor(points.length/2)];after.label={x:middle.x,y:middle.y,width:140};}
      submit({type:'geometry',changes:[{elementId:id,before,after}]});return;
    }
  }
  function pointerDown(event) {
    if(event.button!==0 || !current().bundle || dialog || focusable(event.target))return;
    const state=current(), start=fromClient(event), target=event.target.closest('[data-element-id]'), handle=event.target.closest('[data-handle]');
    const query=session.query({x:start.x,y:start.y,tolerance:8});
    if(!query.ok){report(errText(query));return;}
    const id=handle?.getAttribute('data-handle-id') ?? query.hits[0]?.id ?? target?.getAttribute('data-element-id') ?? null;
    if((tool==='pan'||tempPan)&&!handle){drag={type:'pan',start,last:start,camera:clone(state.view.camera)};stage.setPointerCapture(event.pointerId);return;}
    if(!editable(state)){if(id)select([id]);return;}
    if(handle){
      if(!state.view.selection.includes(id))select([id]);
      drag={type:handle.dataset.handle,id,index:Number(handle.dataset.index),start,last:start,origin:state.bundle,originPoints:session.geometry(id)?.points??[],active:false};
    }else if(id){
      const ids=event.shiftKey?(state.view.selection.includes(id)?state.view.selection.filter(value=>value!==id):[...state.view.selection,id]):state.view.selection.includes(id)?state.view.selection:[id];
      select(ids);
      drag={type:'move',id,ids,start,last:start,origin:state.bundle,active:false};
    }else{
      if(!event.shiftKey)select([]);
      drag={type:'marquee',start,last:start,additive:event.shiftKey,base:[...state.view.selection]};
    }
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function previewDrag() {
    raf=0;if(!drag||!drag.active||drag.type==='marquee'||drag.type==='pan')return;
    const state=current(),scale=state.view.camera.scale;
    const dx=(drag.last.x-drag.start.x)/scale,dy=(drag.last.y-drag.start.y)/scale;
    let command;
    if(drag.type==='move'){
      const x=state.view.snap?Math.round(dx/8)*8:Math.round(dx),y=state.view.snap?Math.round(dy/8)*8:Math.round(dy);
      command={type:'move',ids:drag.ids,dx:x,dy:y};
    }else{
      const place=drag.origin.presentation.elements.find(item=>item.elementId===drag.id),before=geometryFields(place),after=clone(before);
      if(drag.type==='resize'){after.bounds.width=Math.max(24,Math.round(before.bounds.width+dx));after.bounds.height=Math.max(24,Math.round(before.bounds.height+dy));}
      if(drag.type==='bend'){
        const points=drag.originPoints,target=points[drag.index];
        if(!target)return;
        if(after.route.mode!=='manual'){after.route.mode='manual';after.route.points=points;}
        if(after.route.strategy==='orthogonal')after.route.points=moveOrthogonalBend(points,drag.index,dx,dy);
        else after.route.points[drag.index]={x:Math.round(target.x+dx),y:Math.round(target.y+dy)};
      }
      command={type:'geometry',changes:[{elementId:drag.id,before,after}]};
    }
    const result=session.previewGesture(command);
    if(!result.ok)report(errText(result));else report('');
  }
  function pointerMove(event) {
    if(!drag)return;const point=fromClient(event);drag.last=point;
    if(drag.type==='pan'){
      const camera=drag.camera;
      cameraPatch({x:camera.x+point.x-drag.start.x,y:camera.y+point.y-drag.start.y,scale:camera.scale,fit:null});return;
    }
    if(drag.type==='marquee'){renderOverlays(current(),displayed(current()),new Set(current().view.selection));return;}
    if(!drag.active && Math.hypot(point.x-drag.start.x,point.y-drag.start.y)>3){
      const result=session.beginGesture();if(!result.ok){report(errText(result));drag=null;return;}drag.active=true;
    }
    if(drag.active&&!raf)raf=win.requestAnimationFrame(previewDrag);
  }
  function finishPointer(event,cancel=false) {
    if(!drag)return;
    if(raf){win.cancelAnimationFrame(raf);raf=0;if(drag.active&&!cancel)previewDrag();}
    const finished=drag;drag=null;
    if(finished.active){
      const result=cancel?session.cancelGesture('cancelled'):session.completeGesture();
      if(!result.ok)report(errText(result));
      else if(!cancel)notice('One edit applied. Save diagram to keep it.');
    }else if(finished.type==='marquee'&&!cancel){
      const a=worldPoint(finished.start),b=worldPoint(finished.last),rect={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
      if(rect.width>3||rect.height>3){
        const picked=current().bundle.presentation.elements.filter(item=>item.bounds&&intersect(item.bounds,rect)).map(item=>item.elementId);
        select(finished.additive?[...finished.base,...picked]:picked);
      }
    }
    if(event?.pointerId!==undefined&&stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
    draw({type:'view'});
  }
  function handleKey(event) {
    if(dialog&&event.key==='Tab'){
      const controls=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
      if(controls.length){
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();return;}
        if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();return;}
      }
    }
    if(!shell.contains(event.target)&&!drag&&!dialog)return;
    if(dialog&&event.key==='Escape'){event.preventDefault();act('cancel-dialog');return;}
    if(event.key==='Escape'&&drag){event.preventDefault();finishPointer(null,true);return;}
    if(event.target.matches?.('[data-action="select-id"]')&&(event.shiftKey||event.metaKey||event.ctrlKey)&&(event.key==='Enter'||event.key===' ')){
      event.preventDefault();
      act('select-id',event.target.dataset.id,{additive:true,fromOutline:true});
      return;
    }
    if(focusable(event.target)&&event.target!==stage)return;
    const state=current(),ids=state.view.selection;
    if(event.key===' '){if(event.target===stage){event.preventDefault();tempPan=true;}return;}
    if(event.key.toLowerCase()==='v'&&!event.metaKey&&!event.ctrlKey){tool='select';notice('Select mode');return;}
    if(event.key.toLowerCase()==='h'&&!event.metaKey&&!event.ctrlKey){tool='pan';notice('Pan mode');return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();act('save');return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();act(event.shiftKey?'redo':'undo');return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'&&ids.length){event.preventDefault();act('copy');return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='v'&&clipboard){event.preventDefault();act('paste');return;}
    if((event.key==='Delete'||event.key==='Backspace')&&ids.length&&editable(state)){event.preventDefault();act('delete');return;}
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)&&ids.length&&editable(state)){
      event.preventDefault();
      const delta=event.shiftKey?10:1;
      const dx=event.key==='ArrowLeft'?-delta:event.key==='ArrowRight'?delta:0;
      const dy=event.key==='ArrowUp'?-delta:event.key==='ArrowDown'?delta:0;
      const result=submit({type:'move',ids,dx,dy});if(result.ok)notice('Selection moved ' + delta + ' unit' +(delta===1?'':'s')+'.');
    }
  }
  const onClick=event=>{
    const target=event.target.closest('[data-action]');if(!target||target.onclick)return;
    const action=target.dataset.action;
    if(action==='source-panel'||action==='more')target.focus();
    if(action==='create')act(action,target.dataset.kind);
    else if(action==='select-id')act(action,target.dataset.id,{additive:event.shiftKey||event.metaKey||event.ctrlKey,fromOutline:true});
    else if(action==='select-member')act(action,target.dataset.member);
    else act(action);
  };
  const onWheel=event=>{
    if(!event.target.closest('.de-canvas'))return;
    event.preventDefault();
    const point=fromClient(event);
    if(event.ctrlKey||event.metaKey)zoom(Math.exp(-event.deltaY*.002),point);
    else{const camera=current().view.camera;cameraPatch({...camera,x:camera.x-event.deltaX,y:camera.y-event.deltaY,fit:null});}
  };
  let resizeFrame=0;
  const onResize=()=>{
    const breakpoint=win.innerWidth<=1100?'drawer':'desktop';
    const rect=stage.getBoundingClientRect();
    if(lastCanvas&&lastBreakpoint===breakpoint&&lastCanvas.width===rect.width&&lastCanvas.height===rect.height)return;
    if(lastBreakpoint&&lastBreakpoint!==breakpoint&&breakpoint==='drawer'){leftOpen=false;rightOpen=false;}
    if(lastBreakpoint&&lastBreakpoint!==breakpoint&&breakpoint==='desktop'){leftOpen=true;rightOpen=true;}
    lastBreakpoint=breakpoint;
    if(lastCanvas){
      const camera=current().view.camera;
      if(camera.fit)fit();
      else cameraPatch({...camera,x:camera.x+(rect.width-lastCanvas.width)/2,y:camera.y+(rect.height-lastCanvas.height)/2});
    }else fit();
    lastCanvas={width:rect.width,height:rect.height};
    controlsStamp='';renderChrome(current());
  };
  const scheduleResize=()=>{
    if(disposed||resizeFrame)return;
    resizeFrame=win.requestAnimationFrame(()=>{resizeFrame=0;if(!disposed)onResize();});
  };
  const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(scheduleResize):null;
  const onSession=event=>{ if(disposed)return;draw(event); };
  const unsubscribe=session.subscribe(onSession);
  const onPointerUp=event=>finishPointer(event);
  const onPointerCancel=event=>finishPointer(event,true);
  const onLostCapture=event=>{if(drag)finishPointer(event,true);};
  const onKeyUp=event=>{if(event.key===' ')tempPan=false;};
  const onBlur=()=>{tempPan=false;if(drag)finishPointer(null,true);};
  shell.addEventListener('click',onClick);
  stage.addEventListener('pointerdown',pointerDown);stage.addEventListener('pointermove',pointerMove);
  stage.addEventListener('pointerup',onPointerUp);
  stage.addEventListener('pointercancel',onPointerCancel);
  stage.addEventListener('lostpointercapture',onLostCapture);
  stage.addEventListener('wheel',onWheel,{passive:false});
  doc.addEventListener('keydown',handleKey);
  doc.addEventListener('keyup',onKeyUp);
  win.addEventListener('blur',onBlur);
  if(resize)resize.observe(stage);else win.addEventListener('resize',scheduleResize);
  draw();scheduleResize();
  return {
    dispose(){
      if(disposed)return;disposed=true;unsubscribe();resize?.disconnect();win.cancelAnimationFrame(raf);win.cancelAnimationFrame(resizeFrame);
      reviewCleanup?.();conflictMount?.dispose();sourceMount?.dispose();
      shell.removeEventListener('click',onClick);stage.removeEventListener('pointerdown',pointerDown);
      stage.removeEventListener('pointermove',pointerMove);stage.removeEventListener('pointerup',onPointerUp);
      stage.removeEventListener('pointercancel',onPointerCancel);stage.removeEventListener('lostpointercapture',onLostCapture);
      stage.removeEventListener('wheel',onWheel);
      if(!resize)win.removeEventListener('resize',scheduleResize);
      doc.removeEventListener('keydown',handleKey);doc.removeEventListener('keyup',onKeyUp);win.removeEventListener('blur',onBlur);
      shell.remove();elementNodes.clear();renderSignatures.clear();
    },
    refresh(bundle){return session.refresh(bundle);},
    getState(){return session.getState();}
  };
}
