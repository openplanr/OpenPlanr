/**
 * Cascade execution for `planr revise`.
 *
 * Responsibilities:
 *
 *   1. **Build cascade order** — top-down: epic → features → stories → tasks.
 *      The artifact hierarchy is a strict tree; no cycle detection is needed.
 *   2. **Execute the cascade** — for each artifact in order, call the
 *      caller-provided `processOne` closure. The cascade stops on
 *      SIGINT, `[q]uit`, or an unrecoverable agent error, and always
 *      flushes audit entries immediately so an interrupted run leaves an
 *      accurate record.
 *   3. **Progress tracking** — emits a `CascadeProgress` snapshot before
 *      each artifact, with a rolling ETA.
 *
 * This service owns NO rollback logic. Partial cascades that break the
 * artifact graph are the concern of the post-flight rollback.
 */

import type {
  ArtifactType,
  CascadeLevel,
  CascadePlan,
  CascadeProgress,
  OpenPlanrConfig,
} from '../models/types.js';
import { logger } from '../utils/logger.js';
import { listArtifacts, readArtifact } from './artifact-service.js';

// ---------------------------------------------------------------------------
// Cascade order
// ---------------------------------------------------------------------------

/**
 * Resolve the cascade plan for a root artifact, walking its descendants in
 * top-down order. For an epic root, the plan is:
 *   EPIC → [features under epic] → [stories under those features] → [tasks under those stories]
 * For a feature root, the EPIC level is empty and features contain only the root, etc.
 */
export async function buildCascadeOrder(
  projectDir: string,
  config: OpenPlanrConfig,
  rootType: ArtifactType,
  rootId: string,
): Promise<CascadePlan> {
  const levels: CascadeLevel[] = [
    { type: 'epic', label: 'epic', artifactIds: [] },
    { type: 'feature', label: 'features', artifactIds: [] },
    { type: 'story', label: 'stories', artifactIds: [] },
    { type: 'task', label: 'tasks', artifactIds: [] },
  ];

  if (rootType === 'epic') {
    levels[0].artifactIds = [rootId];
    const features = await listArtifacts(projectDir, config, 'feature');
    for (const f of features) {
      const featureArtifact = await readArtifact(projectDir, config, 'feature', f.id);
      if (featureArtifact?.data.epicId === rootId) {
        levels[1].artifactIds.push(f.id);
      }
    }
    for (const featureId of levels[1].artifactIds) {
      const stories = await listArtifacts(projectDir, config, 'story');
      for (const s of stories) {
        const storyArtifact = await readArtifact(projectDir, config, 'story', s.id);
        if (storyArtifact?.data.featureId === featureId) {
          levels[2].artifactIds.push(s.id);
        }
      }
    }
    for (const storyId of levels[2].artifactIds) {
      const tasks = await listArtifacts(projectDir, config, 'task');
      for (const t of tasks) {
        const taskArtifact = await readArtifact(projectDir, config, 'task', t.id);
        if (taskArtifact?.data.storyId === storyId) {
          levels[3].artifactIds.push(t.id);
        }
      }
    }
  } else if (rootType === 'feature') {
    levels[1].artifactIds = [rootId];
    const stories = await listArtifacts(projectDir, config, 'story');
    for (const s of stories) {
      const storyArtifact = await readArtifact(projectDir, config, 'story', s.id);
      if (storyArtifact?.data.featureId === rootId) {
        levels[2].artifactIds.push(s.id);
      }
    }
    for (const storyId of levels[2].artifactIds) {
      const tasks = await listArtifacts(projectDir, config, 'task');
      for (const t of tasks) {
        const taskArtifact = await readArtifact(projectDir, config, 'task', t.id);
        if (taskArtifact?.data.storyId === storyId) {
          levels[3].artifactIds.push(t.id);
        }
      }
    }
  } else if (rootType === 'story') {
    levels[2].artifactIds = [rootId];
    const tasks = await listArtifacts(projectDir, config, 'task');
    for (const t of tasks) {
      const taskArtifact = await readArtifact(projectDir, config, 'task', t.id);
      if (taskArtifact?.data.storyId === rootId) {
        levels[3].artifactIds.push(t.id);
      }
    }
  } else if (rootType === 'task') {
    levels[3].artifactIds = [rootId];
  } else {
    // Non-hierarchy types (quick, backlog, sprint, adr, checklist) — cascade
    // is a no-op scope that only processes the root. We stash the id at the
    // tasks level to avoid leaving the plan empty.
    levels[3].artifactIds = [rootId];
  }

  const orderedIds = levels.flatMap((l) => l.artifactIds);
  return { rootId, rootType, levels, orderedIds };
}

// ---------------------------------------------------------------------------
// Cascade execution + progress reporting
// ---------------------------------------------------------------------------

export interface CascadeProcessOutcome {
  /** Set to `false` when the processor wants the cascade to stop cleanly
   *  (e.g., user pressed `q` at a diff prompt). `true` for normal continuation. */
  continue: boolean;
  /** When `continue === false`, the cascade records this reason in the interrupted state. */
  stopReason?: 'q' | 'agent_error' | 'graph_rollback';
}

export type CascadeProcessor = (args: {
  artifactId: string;
  levelLabel: CascadeLevel['label'];
  progress: CascadeProgress;
}) => Promise<CascadeProcessOutcome>;

export interface CascadeExecuteOptions {
  plan: CascadePlan;
  processor: CascadeProcessor;
  /** Called with every progress snapshot; typically wires into a spinner. */
  onProgress?: (p: CascadeProgress) => void;
  /** Overrides the process-level SIGINT handler for tests; default uses `process`. */
  signalTarget?: NodeJS.Process;
}

export interface CascadeResult {
  completed: number;
  total: number;
  interrupted?: {
    reason: 'q' | 'sigint' | 'agent_error';
    atArtifactId: string;
  };
}

/**
 * Drive the cascade plan through the provided processor. Installs a SIGINT
 * handler for the duration of the run; on Ctrl+C it waits for the current
 * artifact to finish (so no half-written files) and then stops. The SIGINT
 * handler is removed on completion whether or not it fired.
 */
export async function executeCascade(options: CascadeExecuteOptions): Promise<CascadeResult> {
  const { plan, processor } = options;
  const signalTarget = options.signalTarget ?? process;
  const total = plan.orderedIds.length;

  let completed = 0;
  let interruptedByUser = false;
  const sigintHandler = () => {
    interruptedByUser = true;
    logger.warn('\nSIGINT received — cascade will stop after current artifact completes.');
  };
  signalTarget.once('SIGINT', sigintHandler);

  const started = Date.now();
  try {
    for (const level of plan.levels) {
      for (const artifactId of level.artifactIds) {
        if (interruptedByUser) {
          return {
            completed,
            total,
            interrupted: { reason: 'sigint', atArtifactId: artifactId },
          };
        }
        const progress: CascadeProgress = {
          completed,
          total,
          currentArtifactId: artifactId,
          currentLevelLabel: level.label,
          etaSeconds: estimateEta(started, completed, total),
        };
        options.onProgress?.(progress);

        let outcome: CascadeProcessOutcome;
        try {
          outcome = await processor({
            artifactId,
            levelLabel: level.label,
            progress,
          });
        } catch (err) {
          logger.error(
            `Cascade aborted at ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return {
            completed,
            total,
            interrupted: { reason: 'agent_error', atArtifactId: artifactId },
          };
        }

        completed++;

        if (!outcome.continue) {
          return {
            completed,
            total,
            interrupted: {
              reason: outcome.stopReason === 'q' ? 'q' : 'agent_error',
              atArtifactId: artifactId,
            },
          };
        }
      }
    }
    return { completed, total };
  } finally {
    signalTarget.removeListener('SIGINT', sigintHandler);
  }
}

/**
 * Estimate seconds remaining based on observed pace. Returns null for the
 * first couple of samples so the UI doesn't print wildly unstable numbers.
 */
function estimateEta(startedMs: number, completed: number, total: number): number | null {
  if (completed < 2 || total === 0) return null;
  const elapsed = (Date.now() - startedMs) / 1000;
  const perItem = elapsed / completed;
  const remaining = Math.max(0, total - completed);
  return Math.round(perItem * remaining);
}
