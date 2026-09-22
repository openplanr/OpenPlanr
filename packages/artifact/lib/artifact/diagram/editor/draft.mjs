import { clone, sealBundle } from '../authoring/model.mjs';
import { validateAuthoringBundle } from '../authoring/index.mjs';

const meta = kind => ({ kind, schemaVersion: '1.0.0', protocolVersion: '1.13.0' });
/** Create an unsaved blank diagram, or adopt a validated template as new identity. */
export function createDiagramEditorDraft({ diagramId, title, grammar = 'flowchart', template = null }) {
  if (template) {
    const check = validateAuthoringBundle(template);
    if (!check.ok) return check;
    const copy = clone(template);
    copy.diagramId = diagramId; copy.document.diagramId = diagramId; copy.presentation.diagramId = diagramId;
    copy.document.title = title; copy.document.accessibility.title = title;
    // A template copy is not a continuing source synchronization relationship.
    copy.originalSource = null; copy.sourceMap = null;
    const bundle = sealBundle(copy); const checked = validateAuthoringBundle(bundle);
    return checked.ok ? { ok: true, bundle } : checked;
  }
  const document = {
    ...meta('planr-diagram'), diagramId, title, summary: '', audience: 'engineer', grammar: { id: grammar, version: '1.0.0' },
    nodes: [], relations: [], groups: [], lanes: [], events: [], series: [], axes: [], sets: [], annotations: [], emphasis: [], laneOrder: [],
    accessibility: { title, description: '', readingOrder: [] }, documentDigest: '',
  };
  const presentation = {
    ...meta('diagram-presentation'), diagramId, semanticDigest: '', coordinateSystem: 'global-canvas',
    layout: { direction: 'left-right', detailTier: 'balanced' }, theme: { themeId: 'paper', mode: 'light' }, elements: [], presentationDigest: '',
  };
  const bundle = sealBundle({ ...meta('diagram-authoring-bundle'), diagramId, document, presentation, originalSource: null, sourceMap: null, bundleDigest: '' });
  const check = validateAuthoringBundle(bundle);
  return check.ok ? { ok: true, bundle } : check;
}
