/** Conservative text advances shared by layout and quality bounds.
 * Preserve Latin spacing; full-width glyphs and emoji occupy an em. Grapheme
 * segmentation keeps combining marks, flags and joined emoji intact when wrapping.
 */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const diagramGraphemes = (text) =>
  [...segmenter.segment(String(text).normalize('NFC'))].map(({ segment }) => segment);
export function measureDiagramText(text, { glyph = 9, size = 16, letterSpacing = 0 } = {}) {
  return diagramGraphemes(text).reduce((width, cluster) => {
    const wide =
      /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(
        cluster,
      );
    return width + (wide ? Math.max(size, glyph * 2) : glyph) + letterSpacing;
  }, 0);
}
