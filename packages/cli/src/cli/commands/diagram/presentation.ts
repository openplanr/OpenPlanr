import type { DiagramSuccessEnvelope } from '../../../services/diagram-pipeline-service.js';
import { display, logger } from '../../../utils/logger.js';

export function presentDiagramResult(value: DiagramSuccessEnvelope, json: boolean): void {
  if (json) {
    display.line(JSON.stringify(value));
    return;
  }
  logger.success(`${value.diagramId ?? 'Diagram'}: ${value.status}`);
  if (value.directory) display.keyValue('Directory', value.directory);
  if (value.manifest) display.keyValue('Manifest', value.manifest.path);
  display.keyValue('Validation', value.validation.status);
  for (const artifact of value.artifacts) {
    display.keyValue(artifact.mediaType.split(';', 1)[0], artifact.path);
  }
  for (const omission of value.omissions) logger.dim(`${omission.format}: ${omission.reason}`);
  for (const warning of value.warnings) logger.warn(warning);
  if (value.nextAction) {
    display.blank();
    display.line(`Next: ${value.nextAction}`);
  }
}

export function presentDiagramGallery(value: Record<string, unknown>, json: boolean): void {
  if (json) {
    display.line(JSON.stringify(value));
    return;
  }
  const grammars = value.grammars as Array<Record<string, unknown>>;
  logger.heading(`Diagram gallery — ${grammars.length} type${grammars.length === 1 ? '' : 's'}`);
  for (const grammar of grammars) {
    display.line(`  ${String(grammar.grammarId).padEnd(22)} ${String(grammar.title)}`);
  }
  display.blank();
  logger.dim(String(value.nextAction));
}
