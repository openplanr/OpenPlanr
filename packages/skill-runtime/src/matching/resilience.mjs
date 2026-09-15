import { checkpointSession, createSkillSession, recoverSession } from '../lifecycle/sessions.mjs';
import { resolveCapabilities } from '../resolver/capabilities.mjs';
import { resolveInteraction } from '../resolver/interactions.mjs';

function pickProfile(profiles, reference) {
  const matches = profiles.filter(({ hostProfileId, hostProfileVersion }) => (
    hostProfileId === reference.id && hostProfileVersion === reference.version
  ));
  if (matches.length !== 1) throw new TypeError(`Host profile ${reference.id}@${reference.version} must resolve exactly once.`);
  return matches[0];
}

export function runResilienceJourney({ journey, hostProfiles, questions } = {}) {
  if (!journey?.id || !journey.kind) throw new TypeError('journey must have id and kind.');
  let result;
  if (journey.kind === 'capability') {
    result = resolveCapabilities({
      hostProfile: pickProfile(hostProfiles, journey.hostProfile),
      runtimeCapabilities: journey.runtimeCapabilities,
      required: journey.required,
      optional: journey.optional ?? [],
    });
  } else if (journey.kind === 'interaction') {
    result = resolveInteraction({
      hostProfile: pickProfile(hostProfiles, journey.hostProfile),
      runtimeCapabilities: journey.runtimeCapabilities,
      questions: journey.questionIds.map((id) => questions[id]),
      repositoryContext: journey.repositoryContext ?? {},
      headlessQuestionPolicy: journey.headlessQuestionPolicy ?? {},
      session: { sessionId: `GIS-${journey.id}` },
    });
  } else if (journey.kind === 'recovery') {
    const selectedQuestions = journey.questionIds.map((id) => questions[id]);
    const session = createSkillSession({
      skillId: journey.skillId,
      questions: selectedQuestions,
      now: journey.startedAt,
      createSessionId: () => `GIS-${journey.id}`,
    });
    const checkpoint = checkpointSession({
      session,
      context: journey.checkpointContext,
      safeState: journey.safeState ?? {},
      now: journey.checkpointedAt,
    });
    result = recoverSession({
      checkpoint: checkpoint.checkpoint,
      skillId: journey.skillId,
      context: journey.resumeContext,
      questions: selectedQuestions,
      now: journey.resumedAt,
      createSessionId: () => `GIS-${journey.id}-fresh`,
    });
  } else {
    throw new TypeError(`Unknown resilience journey kind: ${journey.kind}.`);
  }
  const checks = Object.entries(journey.expect).map(([field, expected]) => ({
    field,
    expected,
    actual: result[field] ?? null,
    pass: Object.is(result[field] ?? null, expected),
  }));
  return Object.freeze({
    id: journey.id,
    kind: journey.kind,
    pass: checks.every((check) => check.pass),
    checks,
    result,
  });
}

export function evaluateResilienceJourneys({ journeys, hostProfiles, questions } = {}) {
  if (!Array.isArray(journeys) || journeys.length === 0) throw new TypeError('journeys must be a non-empty array.');
  const results = journeys.map((journey) => runResilienceJourney({ journey, hostProfiles, questions }));
  return Object.freeze({
    kind: 'skill-resilience-evaluation',
    schemaVersion: '1.0.0',
    passed: results.every(({ pass }) => pass),
    totals: { journeys: results.length, passed: results.filter(({ pass }) => pass).length },
    results,
  });
}
