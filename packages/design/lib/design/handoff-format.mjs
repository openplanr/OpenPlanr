/** Canonical Markdown projection shared by handoff readers and owner mutations. */
const safeMd = (text) =>
  String(text)
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
export function renderMarkdown(draft, title) {
  const lines = [
    `# ${safeMd(title)} — review handoff`,
    '',
    `Status: ${draft.status}. Source revision: ${draft.basis.sourceRevision}.`,
    '',
    draft.content.summary || 'Owner summary has not been written.',
    '',
  ];
  for (const [key, label] of [
    ['agreedChanges', 'Agreed changes'],
    ['openQuestions', 'Open questions'],
    ['deferred', 'Deferred'],
    ['rejected', 'Rejected'],
  ]) {
    lines.push(`## ${label}`, '');
    for (const item of draft.content[key]) {
      lines.push(
        `- ${safeMd(item.refinement ?? item.text)} — ${safeMd(item.author ?? 'Reviewer')}${item.stale ? ' · original revision' : ''} [source comment](${item.source})`,
      );
      if (item.refinement) lines.push(`  Original comment: ${safeMd(item.text)}`);
    }
    if (!draft.content[key].length) lines.push('None recorded.');
    lines.push('');
  }
  lines.push(
    '## Overall review notes',
    '',
    ...draft.reviewNotes.map((note) => `- ${safeMd(note.text)} (${safeMd(note.reviewId)})`),
    '',
  );
  lines.push(
    '## Verification gaps',
    '',
    ...(draft.verificationGaps.length
      ? draft.verificationGaps.map((value) => `- ${safeMd(value)}`)
      : ['None recorded.']),
    '',
    'Plan and Ship remain separate user invocations.',
    '',
  );
  return lines.join('\n');
}
