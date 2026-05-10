/**
 * Apply structured deltas from AI refine to an artifact — replaces the
 * whole-file `improvedMarkdown` blob contract.
 *
 * Frontmatter changes are surgical (regex per field, same as updateArtifactFields).
 * Body changes target specific ## headings or exact text matches.
 */

export interface BodyChange {
  type: 'replaceSection' | 'replaceText';
  heading?: string;
  findExact?: string;
  replaceWith?: string;
  newContent?: string;
}

function yamlEscapeValue(value: unknown): string {
  const str = String(value);
  const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function applyRefineDeltas(
  raw: string,
  frontmatterChanges?: Record<string, unknown>,
  bodyChanges?: BodyChange[],
): string {
  let result = raw;

  if (frontmatterChanges && Object.keys(frontmatterChanges).length > 0) {
    const openIdx = result.indexOf('---');
    const closeIdx = result.indexOf('\n---', openIdx + 3);
    if (openIdx !== -1 && closeIdx !== -1) {
      let frontmatter = result.slice(openIdx, closeIdx);
      const body = result.slice(closeIdx);

      for (const [key, value] of Object.entries(frontmatterChanges)) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^${escapedKey}:\\s*.*$`, 'm');
        const replacement = `${key}: ${yamlEscapeValue(value)}`;
        if (pattern.test(frontmatter)) {
          frontmatter = frontmatter.replace(pattern, () => replacement);
        } else {
          frontmatter += `\n${replacement}`;
        }
      }
      result = frontmatter + body;
    }
  }

  if (bodyChanges && bodyChanges.length > 0) {
    const openIdx = result.indexOf('---');
    const closeIdx = result.indexOf('\n---', openIdx + 3);
    if (closeIdx === -1) return result;

    const header = result.slice(0, closeIdx + 4);
    let body = result.slice(closeIdx + 4);

    for (const change of bodyChanges) {
      if (change.type === 'replaceSection' && change.heading && change.newContent !== undefined) {
        const headingPattern = new RegExp(
          `(^|\\n)(##\\s+${change.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n)`,
          'i',
        );
        const match = headingPattern.exec(body);
        if (match) {
          const sectionStart = (match.index ?? 0) + match[1].length;
          const afterHeading = sectionStart + match[2].length;
          const nextHeading = body.slice(afterHeading).search(/\n##\s+/);
          const sectionEnd = nextHeading === -1 ? body.length : afterHeading + nextHeading;
          body =
            body.slice(0, sectionStart) +
            match[2] +
            change.newContent.trimEnd() +
            '\n' +
            body.slice(sectionEnd);
        } else {
          body = body.trimEnd() + `\n\n## ${change.heading}\n\n${change.newContent.trimEnd()}\n`;
        }
      } else if (
        change.type === 'replaceText' &&
        change.findExact &&
        change.replaceWith !== undefined
      ) {
        if (body.includes(change.findExact)) {
          body = body.replace(change.findExact, change.replaceWith);
        }
      }
    }

    result = header + body;
  }

  return result;
}
