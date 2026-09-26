const SECRET_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/gu,
  /\b(api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*([^\s,;]+)/giu,
]);

function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError(`${label} must be non-empty text.`);
  return value.trim();
}

function redact(value) {
  let redactions = 0;
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, label) => {
      redactions += 1;
      return typeof label === 'string' ? `${label}=[redacted]` : '[redacted]';
    });
  }
  return { value: result, redactions };
}

export function createLearningProposal(input = {}) {
  const proposalId = text(input.proposalId, 'proposalId');
  const skillId = text(input.skillId, 'skillId');
  const summary = redact(text(input.summary, 'summary'));
  const observation = redact(text(input.observation, 'observation'));
  const suggestedChange = redact(text(input.suggestedChange, 'suggestedChange'));
  const proposal = {
    kind: 'skill-learning-proposal',
    schemaVersion: '1.0.0',
    proposalId,
    skillId,
    createdAt: text(input.createdAt, 'createdAt'),
    status: 'proposed',
    summary: summary.value,
    observation: observation.value,
    suggestedChange: suggestedChange.value,
    sourceMutation: false,
    redactions: summary.redactions + observation.redactions + suggestedChange.redactions,
  };
  return Object.freeze(proposal);
}

export function assessLearningPromotion({ proposal, review, evaluation } = {}) {
  if (proposal?.kind !== 'skill-learning-proposal' || proposal.sourceMutation !== false) {
    throw new TypeError('proposal must be an immutable learning proposal.');
  }
  const reviewed = review?.status === 'accepted' && typeof review?.reviewedBy === 'string';
  const evaluated = evaluation?.passed === true;
  return Object.freeze({
    proposalId: proposal.proposalId,
    eligible: reviewed && evaluated,
    reasons: [
      ...(reviewed ? [] : ['review-not-accepted']),
      ...(evaluated ? [] : ['evaluation-not-passed']),
    ],
    nextAction:
      reviewed && evaluated
        ? 'Edit the canonical source explicitly, apply the required version change, and regenerate affected projections.'
        : 'Keep the proposal separate from canonical source.',
    sourceMutation: false,
  });
}
