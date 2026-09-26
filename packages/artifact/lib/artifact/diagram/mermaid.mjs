import { sha256Hex, withDocumentDigest } from '@openplanr/protocol/canonical-json';

import { DIAGRAM_ERROR_CODES, diagramFail } from './errors.mjs';
import { createDiagramDocument } from './model.mjs';

const MAX_MERMAID_BYTES = 65_536;
const HEADER = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*$/iu;
const EDGE = /^(.*?)\s*(-->|---|-.->)\s*(?:\|([^|]+)\|\s*)?(.*?)\s*$/u;
const NODE = /^([A-Za-z][A-Za-z0-9_-]*)(?:\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}))?\s*$/u;
const DIRECTIONS = Object.freeze({
  TB: 'top-down',
  TD: 'top-down',
  BT: 'bottom-up',
  LR: 'left-right',
  RL: 'right-left',
});
const SEQUENCE_HEADER = /^sequenceDiagram\s*$/iu;
const PARTICIPANT = /^participant\s+([A-Za-z][A-Za-z0-9_]*)\s+as\s+(.+)$/iu;
const MESSAGE = /^([A-Za-z][A-Za-z0-9_]*)\s*(-->>|->>)\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/u;
const PHASE_NOTE = /^Note\s+over\s+([^,\s]+)\s*,\s*([^:\s]+)\s*:\s*Phase:\s*(.+)$/iu;
const MESSAGE_NOTE = /^Note\s+over\s+([^,\s]+)\s*,\s*([^:\s]+)\s*:\s*Note:\s*(.+)$/iu;
const PARTICIPANT_NOTE = /^Note\s+right\s+of\s+([^:\s]+)\s*:\s*Note:\s*(.+)$/iu;

const cleanLabel = (value, fallback) =>
  String(value ?? fallback)
    .trim()
    .replace(/^["']|["']$/gu, '');
const semanticId = (value) =>
  String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
const parseNodeExpression = (value) => {
  const match = String(value).trim().match(NODE);
  if (!match) return null;
  return {
    rawId: match[1],
    label: match[2] ?? match[3] ?? match[4] ?? match[1],
    kind: match[4] ? 'decision' : 'step',
  };
};

export function importMermaid(
  source,
  {
    diagramId = 'imported-flowchart',
    title = 'Imported flowchart',
    summary = 'Semantic proposal imported from Mermaid.',
    audience = 'mixed',
    detailTier = 'balanced',
    themeId = 'openplanr-default',
    mode = 'auto',
    sourcePath = null,
  } = {},
) {
  const bytes = String(source).replace(/\r\n?/gu, '\n');
  if (Buffer.byteLength(bytes, 'utf8') > MAX_MERMAID_BYTES) {
    diagramFail(
      DIAGRAM_ERROR_CODES.MERMAID_TOO_LARGE,
      `Mermaid input exceeds ${MAX_MERMAID_BYTES} bytes.`,
    );
  }
  if (
    /%%\{|<(?:script|foreignObject)\b|javascript:|https?:\/\/|(?:^|\s)(?:click|href)\s+/imu.test(
      bytes,
    )
  ) {
    diagramFail(
      DIAGRAM_ERROR_CODES.MERMAID_INVALID,
      'Mermaid input contains executable configuration or an external resource.',
      {
        repair: 'Remove directives, links, scripts, and remote resources before importing.',
      },
    );
  }
  const lines = bytes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
  if (SEQUENCE_HEADER.test(lines[0] ?? '')) {
    lines.shift();
    return importSequenceMermaid(bytes, lines, {
      diagramId,
      title,
      summary,
      audience,
      detailTier,
      themeId,
      mode,
      sourcePath,
    });
  }
  const header = lines.shift()?.match(HEADER);
  if (!header)
    diagramFail(
      DIAGRAM_ERROR_CODES.MERMAID_INVALID,
      'Only bounded Mermaid flowchart/graph input is supported in Protocol 1.6.',
    );
  const nodes = new Map();
  const relations = [];
  const interpreted = [{ source: header[0], targetId: diagramId, construct: 'flowchart-header' }];
  const omitted = [];
  const ensureNode = (rawId, label = rawId, kind = 'step') => {
    const id = semanticId(rawId);
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        label: cleanLabel(label, rawId),
        kind,
        description: null,
        semanticPosition: null,
      });
    return id;
  };
  for (const line of lines) {
    const edge = line.match(EDGE);
    if (edge) {
      const sourceNode = parseNodeExpression(edge[1]);
      const targetNode = parseNodeExpression(edge[4]);
      if (sourceNode && targetNode) {
        const from = ensureNode(sourceNode.rawId, sourceNode.label, sourceNode.kind);
        const to = ensureNode(targetNode.rawId, targetNode.label, targetNode.kind);
        const relationId = `relation-${relations.length + 1}`;
        relations.push({
          id: relationId,
          from,
          to,
          kind: 'flow',
          label: edge[3] ? cleanLabel(edge[3]) : null,
          weight: null,
        });
        interpreted.push({ source: line, targetId: relationId, construct: 'relation' });
        continue;
      }
    }
    const node = parseNodeExpression(line);
    if (node) {
      const id = ensureNode(node.rawId, node.label, node.kind);
      interpreted.push({ source: line, targetId: id, construct: 'node' });
      continue;
    }
    omitted.push({
      source: line,
      reason: 'Construct is outside the bounded flowchart import subset.',
    });
  }
  if (nodes.size === 0)
    diagramFail(
      DIAGRAM_ERROR_CODES.MERMAID_INVALID,
      'Mermaid input contains no supported semantic nodes.',
    );
  const document = createDiagramDocument({
    diagramId,
    title,
    summary,
    audience,
    grammar: { id: 'flowchart', version: '1.0.0' },
    layout: { direction: DIRECTIONS[header[1].toUpperCase()], detailTier },
    theme: { themeId, mode },
    source: { format: 'mermaid', path: sourcePath, digest: `sha256:${sha256Hex(bytes)}` },
    nodes: [...nodes.values()],
    relations,
    accessibility: {
      title,
      description: summary,
      readingOrder: [...nodes.keys()],
    },
  });
  const fidelity = withDocumentDigest({
    kind: 'diagram-fidelity-report',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    diagramId,
    sourceFormat: 'mermaid',
    targetFormat: 'planr-diagram',
    status: omitted.length > 0 ? 'partial' : 'editable',
    interpreted,
    omitted,
    notes: [
      'Mermaid renderer coordinates, styling, classes, and themes are never imported into canonical IR.',
    ],
  });
  return Object.freeze({ document, fidelity });
}

function importSequenceMermaid(
  bytes,
  lines,
  { diagramId, title, summary, audience, detailTier, themeId, mode, sourcePath },
) {
  const participants = new Map();
  const relations = [];
  const events = [];
  const annotations = [];
  const timeline = [];
  const interpreted = [
    { source: 'sequenceDiagram', targetId: diagramId, construct: 'sequence-header' },
  ];
  const omitted = [];
  let lastRelation = null;
  const ensureParticipant = (alias, label = alias) => {
    if (!participants.has(alias)) {
      participants.set(alias, {
        id: semanticId(alias) || `participant-${participants.size + 1}`,
        label: cleanLabel(label, alias),
        kind: 'participant',
        description: null,
        semanticPosition: null,
      });
    }
    return participants.get(alias);
  };
  for (const line of lines) {
    const participant = line.match(PARTICIPANT);
    if (participant) {
      const value = ensureParticipant(participant[1], participant[2]);
      interpreted.push({ source: line, targetId: value.id, construct: 'participant' });
      continue;
    }
    const message = line.match(MESSAGE);
    if (message) {
      const from = ensureParticipant(message[1]);
      const to = ensureParticipant(message[3]);
      const relation = {
        id: `message-${relations.length + 1}`,
        from: from.id,
        to: to.id,
        kind: message[2] === '-->>' ? 'flow' : 'message',
        label: cleanLabel(message[4]),
        weight: null,
      };
      relations.push(relation);
      timeline.push(relation.id);
      lastRelation = relation;
      interpreted.push({ source: line, targetId: relation.id, construct: 'message' });
      continue;
    }
    const phase = line.match(PHASE_NOTE);
    if (phase) {
      const event = {
        id: `phase-${events.length + 1}`,
        label: cleanLabel(phase[3]),
        order: events.length,
        at: null,
      };
      events.push(event);
      timeline.push(event.id);
      interpreted.push({ source: line, targetId: event.id, construct: 'phase-note' });
      continue;
    }
    const messageNote = line.match(MESSAGE_NOTE);
    if (messageNote && lastRelation) {
      const annotation = {
        id: `annotation-${annotations.length + 1}`,
        text: cleanLabel(messageNote[3]),
        targetId: lastRelation.id,
      };
      annotations.push(annotation);
      interpreted.push({ source: line, targetId: annotation.id, construct: 'message-note' });
      continue;
    }
    const participantNote = line.match(PARTICIPANT_NOTE);
    if (participantNote) {
      const target = ensureParticipant(participantNote[1]);
      const annotation = {
        id: `annotation-${annotations.length + 1}`,
        text: cleanLabel(participantNote[2]),
        targetId: target.id,
      };
      annotations.push(annotation);
      interpreted.push({ source: line, targetId: annotation.id, construct: 'participant-note' });
      continue;
    }
    omitted.push({
      source: line,
      reason: 'Construct is outside the bounded sequence import subset.',
    });
  }
  if (participants.size === 0 || relations.length === 0 || events.length === 0) {
    diagramFail(
      DIAGRAM_ERROR_CODES.MERMAID_INVALID,
      'Sequence Mermaid requires participants, messages, and at least one Phase note.',
    );
  }
  const nodes = [...participants.values()];
  const document = createDiagramDocument({
    diagramId,
    title,
    summary,
    audience,
    grammar: { id: 'sequence', version: '1.0.0' },
    layout: { direction: 'left-right', detailTier },
    theme: { themeId, mode },
    source: { format: 'mermaid', path: sourcePath, digest: `sha256:${sha256Hex(bytes)}` },
    nodes,
    relations,
    events,
    annotations,
    accessibility: {
      title,
      description: summary,
      readingOrder: [...nodes.map(({ id }) => id), ...timeline],
    },
  });
  const fidelity = withDocumentDigest({
    kind: 'diagram-fidelity-report',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    diagramId,
    sourceFormat: 'mermaid',
    targetFormat: 'planr-diagram',
    status: omitted.length > 0 ? 'partial' : 'editable',
    interpreted,
    omitted,
    notes: ['Sequence styling and renderer geometry are not imported into canonical IR.'],
  });
  return Object.freeze({ document, fidelity });
}

export { MAX_MERMAID_BYTES };
