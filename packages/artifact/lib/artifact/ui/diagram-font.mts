import { DIAGRAM_FONT_DIGEST } from './generated/diagram-font-info.mjs';

const fontPromises = new WeakMap<Document, Promise<void>>();
/** One packaged font per document; font failures never masquerade as a verified render. */
export function ensureDiagramFont(
  document: Document,
  source?: string | BufferSource,
): Promise<void> {
  let ready = fontPromises.get(document);
  if (!ready) {
    ready = (async () => {
      const window = document.defaultView as Window & typeof globalThis;
      if (!window.FontFace || !document.fonts)
        throw new Error('This browser cannot load the packaged diagram font.');
      const response =
        typeof source === 'string' || source === undefined
          ? await window.fetch(source ?? new URL('diagram-font.ttf', document.baseURI).href, {
              credentials: 'same-origin',
            })
          : null;
      if (response && !response.ok) throw new Error('The packaged diagram font could not be read.');
      const fontBytes = response ? await response.arrayBuffer() : (source as BufferSource);
      const digest = new Uint8Array(await window.crypto.subtle.digest('SHA-256', fontBytes));
      if (
        `sha256:${Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')}` !==
        DIAGRAM_FONT_DIGEST
      )
        throw new Error('The packaged diagram font identity changed.');
      const font = new window.FontFace('Inter', fontBytes, { weight: '400', style: 'normal' });
      await font.load();
      document.fonts.add(font);
      await document.fonts.load('400 14px Inter');
      if (!document.fonts.check('400 14px Inter'))
        throw new Error('The packaged diagram font did not become available.');
    })();
    fontPromises.set(document, ready);
  }
  return ready;
}
