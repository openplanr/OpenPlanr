import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { assertDesignDocument } from '@openplanr/protocol/design-contracts';
import { prepareDesignDocument, withDesignRenderLock } from './document.mjs';
import { atomicJson, currentDesign, designSpecPath, readJson } from './document-state.mjs';

export async function saveDesignLayout(file, input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['revision', 'boards', 'restoreRevision'].includes(key)) ||
    typeof input.revision !== 'string' ||
    Object.hasOwn(input, 'boards') === Object.hasOwn(input, 'restoreRevision')
  )
    throw new Error('Design layout requires a revision and either boards or restoreRevision.');
  return withDesignRenderLock(file, async (render) => {
    const current = currentDesign(file);
    if (input.revision !== current.revision)
      throw Object.assign(new Error('The design changed. Reload before saving its layout.'), {
        statusCode: 409,
      });
    const authored = prepareDesignDocument(file);
    const authoredContent = { ...authored.document };
    const committedContent = { ...current.document };
    delete authoredContent.layout;
    delete committedContent.layout;
    if (
      digestArtifactEnvelope(authored.envelope) !== digestArtifactEnvelope(current.envelope) ||
      JSON.stringify(authored.fingerprints) !== JSON.stringify(current.fingerprints) ||
      JSON.stringify(authoredContent) !== JSON.stringify(committedContent) ||
      readFileSync(designSpecPath(current.root), 'utf8') !==
        readFileSync(join(current.directory, 'design-spec.md'), 'utf8')
    )
      throw Object.assign(
        new Error(
          'Design sources or content changed. Render the design and reload before saving its layout.',
        ),
        { statusCode: 409 },
      );
    const previous = readJson(file);
    const mode = statSync(file).mode & 0o7777;
    const document = structuredClone(previous);
    if (Object.hasOwn(input, 'restoreRevision')) {
      if (
        typeof input.restoreRevision !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(input.restoreRevision)
      )
        throw new Error(`Invalid layout restore revision ${input.restoreRevision}.`);
      const restored = readJson(
        join(current.root, '.design/revisions', input.restoreRevision, 'design-document.json'),
      );
      if (restored.layout === undefined) delete document.layout;
      else document.layout = structuredClone(restored.layout);
    } else {
      if (!input.boards || typeof input.boards !== 'object' || Array.isArray(input.boards))
        throw new Error('Design layout boards must be an object of exact board keys.');
      const boards = { ...document.layout?.boards };
      for (const [key, point] of Object.entries(input.boards)) {
        if (
          !current.entries.some(
            (entry) => `${entry.screenId}/${entry.frameId}/${entry.variantId}` === key,
          )
        )
          throw new Error(`Unknown exact design board key ${key}.`);
        if (point === null) delete boards[key];
        else {
          if (
            !point ||
            typeof point !== 'object' ||
            Array.isArray(point) ||
            Object.keys(point).some((field) => !['x', 'y'].includes(field)) ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            Math.abs(point.x) > 1e7 ||
            Math.abs(point.y) > 1e7
          )
            throw new Error(
              `Design board ${key} requires finite x and y coordinates within ±10000000.`,
            );
          boards[key] = { ...boards[key], x: point.x, y: point.y };
        }
      }
      document.layout = { ...document.layout, boards };
      if (!Object.keys(boards).length) delete document.layout.boards;
      if (!Object.keys(document.layout).length) delete document.layout;
    }
    assertDesignDocument(document);
    atomicJson(file, document, { mode });
    try {
      const result = await render();
      return { revision: result.revision };
    } catch (error) {
      atomicJson(file, previous, { mode });
      throw error;
    }
  });
}
