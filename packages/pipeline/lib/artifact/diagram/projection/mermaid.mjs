import { getGrammar } from '../registry.mjs';
import { createFidelityReport } from '../rendering/reports.mjs';

const DIRECTION = Object.freeze({
  'top-down': 'TD',
  'bottom-up': 'BT',
  'left-right': 'LR',
  'right-left': 'RL',
  radial: 'TD',
});

function mermaidLabel(value) {
  return String(value)
    .normalize('NFC')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '<br/>');
}

export const MERMAID_EXPORT_CAPABILITIES = Object.freeze(Object.fromEntries(
  ['flowchart', 'sequence'].map((grammarId) => [grammarId, Object.freeze({
    grammarId,
    status: 'editable',
    reason: grammarId === 'sequence'
      ? 'The bounded sequence projection preserves participants, ordered messages, phases, and notes.'
      : 'The bounded flowchart projection preserves nodes, directed relations, labels, and direction.',
  })]),
));

export function mermaidCapability(grammarId) {
  const supported = MERMAID_EXPORT_CAPABILITIES[grammarId];
  if (supported) return supported;
  const grammar = getGrammar(grammarId);
  return Object.freeze({
    grammarId,
    status: grammar.projections.mermaid === 'unsupported' ? 'unsupported' : 'partial',
    reason: `Production export is not implemented for the ${grammarId} semantic grammar; registry capability is ${grammar.projections.mermaid}.`,
  });
}

export function exportDiagramMermaid(document) {
  const capability = mermaidCapability(document.grammar.id);
  if (capability.status !== 'editable') {
    return Object.freeze({
      source: null,
      report: createFidelityReport(document, {
        targetFormat: 'mermaid',
        status: capability.status,
        omitted: [{ source: document.grammar.id, reason: capability.reason }],
        notes: ['SVG, HTML, and PNG remain the canonical render projections.'],
      }),
    });
  }
  if (document.grammar.id === 'sequence') return exportSequenceMermaid(document, capability);
  const lines = [`flowchart ${DIRECTION[document.layout.direction]}`];
  for (const node of document.nodes) lines.push(`  ${node.id}["${mermaidLabel(node.label)}"]`);
  for (const relation of document.relations) {
    const label = relation.label ? `|"${mermaidLabel(relation.label)}"|` : '';
    lines.push(`  ${relation.from} -->${label} ${relation.to}`);
  }
  const source = `${lines.join('\n')}\n`;
  return Object.freeze({
    source,
    report: createFidelityReport(document, {
      targetFormat: 'mermaid',
      status: 'editable',
      interpreted: [
        ...document.nodes.map((node) => ({ source: `node:${node.id}`, targetId: node.id, construct: 'node' })),
        ...document.relations.map((relation) => ({ source: `relation:${relation.id}`, targetId: relation.id, construct: 'relation' })),
      ],
      notes: [capability.reason],
    }),
  });
}

function sequenceTimeline(document) {
  const events = new Map(document.events.map((event) => [event.id, event]));
  const relations = new Map(document.relations.map((relation) => [relation.id, relation]));
  const ordered = document.accessibility.readingOrder.filter((id) => events.has(id) || relations.has(id));
  const seen = new Set();
  const timeline = [];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (events.has(id)) timeline.push({ type: 'phase', value: events.get(id) });
    else timeline.push({ type: 'message', value: relations.get(id) });
  }
  for (const event of [...document.events].sort((left, right) => left.order - right.order)) {
    if (!seen.has(event.id)) timeline.push({ type: 'phase', value: event });
  }
  for (const relation of document.relations) {
    if (!seen.has(relation.id)) timeline.push({ type: 'message', value: relation });
  }
  return timeline;
}

function exportSequenceMermaid(document, capability) {
  const reversed = ['right-left', 'bottom-up'].includes(document.layout.direction);
  const participants = reversed ? [...document.nodes].reverse() : [...document.nodes];
  const aliases = new Map(participants.map((participant, index) => [participant.id, `p${index + 1}`]));
  const first = aliases.get(participants[0].id);
  const last = aliases.get(participants.at(-1).id);
  const lines = ['sequenceDiagram'];
  for (const participant of participants) {
    lines.push(`  participant ${aliases.get(participant.id)} as ${mermaidLabel(participant.label)}`);
  }
  const interpreted = participants.map((participant) => ({ source: `node:${participant.id}`, targetId: participant.id, construct: 'participant' }));
  const emittedAnnotations = new Set();
  for (const entry of sequenceTimeline(document)) {
    if (entry.type === 'phase') {
      lines.push(`  Note over ${first},${last}: Phase: ${mermaidLabel(entry.value.label)}`);
      interpreted.push({ source: `event:${entry.value.id}`, targetId: entry.value.id, construct: 'phase-note' });
      continue;
    }
    const relation = entry.value;
    const from = aliases.get(relation.from);
    const to = aliases.get(relation.to);
    if (!from || !to) continue;
    lines.push(`  ${from}${relation.kind === 'flow' ? '-->>' : '->>'}${to}: ${mermaidLabel(relation.label ?? relation.kind)}`);
    interpreted.push({ source: `relation:${relation.id}`, targetId: relation.id, construct: 'message' });
    for (const annotation of document.annotations.filter(({ targetId }) => targetId === relation.id)) {
      lines.push(`  Note over ${from},${to}: Note: ${mermaidLabel(annotation.text)}`);
      interpreted.push({ source: `annotation:${annotation.id}`, targetId: annotation.id, construct: 'message-note' });
      emittedAnnotations.add(annotation.id);
    }
  }
  for (const annotation of document.annotations.filter(({ id }) => !emittedAnnotations.has(id))) {
    const participant = aliases.get(annotation.targetId);
    if (!participant) continue;
    lines.push(`  Note right of ${participant}: Note: ${mermaidLabel(annotation.text)}`);
    interpreted.push({ source: `annotation:${annotation.id}`, targetId: annotation.id, construct: 'participant-note' });
    emittedAnnotations.add(annotation.id);
  }
  const omitted = document.emphasis.map(({ targetId }) => ({
    source: `emphasis:${targetId}`,
    reason: 'Mermaid sequence source does not preserve OpenPlanr emphasis levels.',
  }));
  const source = `${lines.join('\n')}\n`;
  return Object.freeze({
    source,
    report: createFidelityReport(document, {
      targetFormat: 'mermaid',
      status: omitted.length > 0 ? 'partial' : 'editable',
      interpreted,
      omitted,
      notes: [capability.reason, 'Participant order represents the selected OpenPlanr direction.'],
    }),
  });
}
