import { describe, expect, it } from 'vitest';
import { normalizeGuidedAnswerValue } from '../../src/services/operate/interaction/question-engine.js';
import type { GuidedQuestion } from '../../src/services/operate/interaction/types.js';

/**
 * A first `planr operate init` on a clean project failed its write-free preview
 * with `Known unknowns does not satisfy its bounded validation rules` — for a
 * question declared `required: false` whose own contract says recording unknowns
 * "never blocks reaching the write-free preview". The questionnaire never
 * surfaced that question, so there was no way to satisfy it from the answers;
 * the only route past it was to guess.
 *
 * Lower bounds describe what a SUPPLIED answer must contain. An optional answer
 * left empty is absent, not invalid.
 */

const optionalList: GuidedQuestion = {
  kind: 'guided-question',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  questionId: 'known-unknowns',
  questionVersion: '1.0.0',
  type: 'repeated-text',
  label: 'Known unknowns',
  explanation: 'Uncertainty is recorded as a gap.',
  required: false,
  sensitivity: 'internal',
  persistence: 'session',
  valueSemantics: 'answer',
  validation: { minItems: 1, maxItems: 50 },
} as unknown as GuidedQuestion;

const requiredList: GuidedQuestion = {
  ...optionalList,
  questionId: 'guardrails',
  label: 'Guardrails',
  required: true,
} as unknown as GuidedQuestion;

describe('bounded validation distinguishes an absent optional answer from an invalid one', () => {
  it('accepts an optional question left empty', () => {
    expect(normalizeGuidedAnswerValue(optionalList, [])).toEqual([]);
  });

  it('accepts an optional question whose entries are all blank', () => {
    // Normalization strips blanks, so this collapses to empty — still absent.
    expect(normalizeGuidedAnswerValue(optionalList, ['   ', ''])).toEqual([]);
  });

  it('still enforces the lower bound once an optional answer is supplied', () => {
    // maxItems must bite even on an optional field the author did fill in.
    const tooMany = Array.from({ length: 51 }, (_, index) => `unknown-${index}`);
    expect(() => normalizeGuidedAnswerValue(optionalList, tooMany)).toThrow(
      /allows at most 50 item\(s\), received 51/,
    );
  });

  it('still rejects a REQUIRED question left empty', () => {
    expect(() => normalizeGuidedAnswerValue(requiredList, [])).toThrow(
      /needs at least 1 item\(s\), received 0/,
    );
  });

  it('names the rule and the received value, not just the field', () => {
    // The original message was "<label> does not satisfy its bounded validation
    // rules." — true, and useless: an author could not tell which bound was
    // missed or by how much.
    let message = '';
    try {
      normalizeGuidedAnswerValue(requiredList, []);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Guardrails');
    expect(message).toContain('at least 1');
    expect(message).toContain('received 0');
  });
});
