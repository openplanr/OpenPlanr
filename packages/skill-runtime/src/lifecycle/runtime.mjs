import { resolveInteraction } from '../resolver/interactions.mjs';

import { assessLifecycleCompatibility } from './compatibility.mjs';
import {
  loadLifecycleConfiguration,
  normalizeLifecycleConfiguration,
} from './configuration.mjs';
import { cleanupLifecycleProgress } from './cleanup.mjs';
import { classifyOperation, resolveLifecycleSettings } from './consent.mjs';
import {
  COMPLETION_STATUSES,
  completionFromRuntimeResult,
  createCompletion,
} from './completion.mjs';
import { prepareLifecycleEnvironment } from './environment.mjs';
import { firstRunGuidance } from './first-run.mjs';
import { freezeJson } from './internal.mjs';
import { loadLatestSessionProgress } from './progress.mjs';
import { recoverSession } from './sessions.mjs';

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date().toISOString());
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError('now must be an ISO date-time string.');
  }
  return value;
}

/**
 * Compose quiet first-run defaults, local recovery, cleanup, and compatibility.
 * Persistence remains best-effort and never becomes a prerequisite for work.
 */
export function startSkillLifecycle({
  projectRoot,
  skillId,
  projectIdentity,
  context = {},
  questions = [],
  configured,
  consents = [],
  headless = false,
  now,
  createSessionId,
} = {}) {
  const clock = nowIso(now);
  const environment = prepareLifecycleEnvironment({ projectRoot });
  const configuration = configured === undefined
    ? environment.stateAvailable
      ? loadLifecycleConfiguration({ projectRoot: environment.projectRoot })
      : freezeJson({ status: 'partial', source: 'default', settings: normalizeLifecycleConfiguration(), notice: environment.notice })
    : freezeJson({ status: 'completed', source: 'call', settings: normalizeLifecycleConfiguration(configured), notice: 'Used explicit lifecycle settings.' });
  const lifecycle = resolveLifecycleSettings({
    skillId,
    projectIdentity,
    configured: configuration.settings,
    consents,
    headless,
  });

  const cleanup = environment.stateAvailable
    ? cleanupLifecycleProgress({ projectRoot: environment.projectRoot, now: clock })
    : freezeJson({ status: 'partial', removed: [], retained: 0, unreadable: 0, notice: environment.notice });
  const progress = environment.stateAvailable
    ? loadLatestSessionProgress({ projectRoot: environment.projectRoot, skillId, now: clock })
    : freezeJson({ status: 'unavailable', record: null, unreadable: 0, notice: environment.notice });
  const compatibility = assessLifecycleCompatibility({ state: progress.record });
  const recovery = recoverSession({
    checkpoint: compatibility.compatible ? progress.record?.checkpoint ?? null : null,
    skillId,
    context,
    questions,
    now: clock,
    createSessionId,
  });
  const firstRun = firstRunGuidance({ environment, settings: lifecycle.settings });

  return freezeJson({
    status: 'completed',
    environment,
    firstRun,
    compatibility,
    configuration,
    settings: lifecycle,
    progress: {
      status: progress.status,
      recovered: recovery.mode === 'recovered',
      notice: progress.notice,
    },
    recovery,
    cleanup,
  });
}

/**
 * Start or recover lifecycle state, then select the host's declared interaction
 * surface for that exact internal session. Questionnaire custody stays a
 * separate resolver input and this facade adds no policy or execution gate.
 */
export function startSkillInteraction({
  projectRoot,
  skillId,
  context = {},
  questions = [],
  configured,
  consents = [],
  headless = false,
  now,
  createSessionId,
  hostProfile,
  runtimeCapabilities = {},
  repositoryContext = {},
  questionnaire = {},
  headlessQuestionPolicy = {},
} = {}) {
  const lifecycle = startSkillLifecycle({
    projectRoot,
    skillId,
    projectIdentity: questionnaire.projectIdentity,
    context,
    questions,
    configured,
    consents,
    headless,
    now,
    createSessionId,
  });
  const interaction = resolveInteraction({
    hostProfile,
    runtimeCapabilities,
    repositoryContext,
    session: lifecycle.recovery.session,
    questionnaire,
    headlessQuestionPolicy,
  });
  return freezeJson({
    status: interaction.status,
    lifecycle,
    interaction,
  });
}

/**
 * Dispatch one classified operation directly to the local or host executor.
 * The host callback owns its normal effect controls; this layer adds no gate.
 */
export async function executeAtEffectBoundary({
  operationClass,
  localExecutor,
  hostExecutor,
} = {}) {
  const route = classifyOperation(operationClass);
  const executor = route.execution === 'host' ? hostExecutor : localExecutor;
  if (typeof executor !== 'function') {
    return createCompletion({
      status: 'unavailable',
      summary: `${route.execution === 'host' ? 'Host' : 'Local'} execution is unavailable.`,
      checks: [{ name: 'effect-boundary', status: 'not-run', detail: `No ${route.execution} executor was supplied.` }],
      issues: [{
        problem: `The ${route.execution} executor is unavailable.`,
        impact: 'The operation was not attempted.',
        nextAction: `Run through a host that supplies the ${route.execution} executor, or continue without this effect.`,
      }],
    });
  }
  const request = freezeJson({ operationClass: route.operationClass, effect: route.effect });
  const output = await executor(request);
  if (
    output
    && typeof output === 'object'
    && !Array.isArray(output)
    && (COMPLETION_STATUSES.includes(output.status) || output.status === 'denied')
  ) {
    const status = output.status === 'denied' ? 'unavailable' : output.status;
    return completionFromRuntimeResult(output, {
      summary: typeof output.summary === 'string' && output.summary.trim().length > 0
        ? output.summary
        : `${route.execution === 'host' ? 'Host' : 'Local'} execution returned ${status}.`,
      checks: Array.isArray(output.checks)
        ? output.checks
        : [{
            name: 'effect-boundary',
            status: status === 'completed' ? 'passed' : 'failed',
            detail: `The ${route.execution} executor returned ${status}.`,
          }],
      issues: Array.isArray(output.issues) ? output.issues : [],
    });
  }
  return createCompletion({
    status: 'completed',
    summary: `${route.execution === 'host' ? 'Host' : 'Local'} execution completed.`,
    checks: [{ name: 'effect-boundary', status: 'passed', detail: `Executed by the ${route.execution} boundary.` }],
    ...(output === undefined ? {} : { output }),
  });
}
