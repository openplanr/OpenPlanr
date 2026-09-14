import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertOperateReviewDisplayWorkspaceV1,
  type OperateReviewDisplayWorkspaceV1,
} from '@openplanr/protocol/dashboard/operate-review-contract.mjs';
import { parseDashboardRoute } from '../../../app/router.js';
import type {
  DashboardProductState,
  DashboardProductStateKind,
} from '../../../lib/api/product-state.js';
import {
  isValidatedDashboardProductState,
  productStateAllowsMutation,
} from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

export type OperateReviewWorkspace = Readonly<OperateReviewDisplayWorkspaceV1>;
export type OperateReviewChoice = OperateReviewWorkspace['payload']['data']['choices'][number];
type ReviewAction = Extract<
  OperateReviewWorkspace['payload']['data']['capability'],
  { available: true }
>['actions'][number];

export type OperateReviewChoiceModel = Readonly<{
  choice: OperateReviewChoice;
  action: ReviewAction | null;
  locator: Readonly<{ subjectId: string; actionDigest: string }> | null;
}>;

export type OperateReviewModel = Readonly<{
  kind: 'review';
  binding: DashboardQueryIdentity;
  workspace: OperateReviewWorkspace;
  payload: OperateReviewWorkspace['payload'];
  presentation: DashboardProductStateKind | 'terminal';
  choices: readonly OperateReviewChoiceModel[];
  mutationEnabled: boolean;
  terminal: boolean;
}>;

function sameHead(
  left: DashboardQueryIdentity['eventHead'],
  right: OperateReviewWorkspace['payload']['sourceEventHead'],
): boolean {
  return left?.sequence === right.sequence && left.hash === right.hash;
}

function exactReviewBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    const route = parseDashboardRoute(binding.route);
    return route.kind === 'operate.review' &&
      binding.productArea === 'operate' &&
      binding.cycleId === route.cycleId &&
      binding.subjectId === route.subjectId &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Exact route/head/actor validator over the pipeline-issued Review workspace. */
export function createOperateReviewDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is OperateReviewWorkspace {
  const binding = exactReviewBinding(current);
  return (value: unknown): value is OperateReviewWorkspace => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      assertOperateReviewDisplayWorkspaceV1(value);
      const workspace = value as OperateReviewWorkspace;
      const payload = workspace.payload;
      if (
        payload.cycleId !== binding.cycleId ||
        payload.reviewId !== binding.subjectId ||
        payload.actorId !== binding.actorId ||
        payload.scopeId !== binding.scopeId ||
        payload.domainId !== binding.domainId ||
        payload.domainVersion !== binding.domainVersion ||
        !sameHead(binding.eventHead, payload.sourceEventHead) ||
        payload.sourceViewHash !== binding.viewHash
      ) {
        return false;
      }
      assertOperateReviewDisplayWorkspaceV1(workspace, {
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
        cycleId: payload.cycleId,
        reviewId: payload.reviewId,
        sourceArtifactKind: payload.sourceArtifactKind,
        sourceArtifactHash: payload.sourceArtifactHash,
        sourceEventHead: payload.sourceEventHead,
        sourceReadEventHead: payload.sourceReadEventHead,
        sourceViewHash: payload.sourceViewHash,
      });
      return true;
    } catch {
      return false;
    }
  };
}

function choiceModels(
  workspace: OperateReviewWorkspace,
): readonly OperateReviewChoiceModel[] | null {
  const capability = workspace.payload.data.capability;
  const actions = capability.available ? capability.actions : [];
  const mapped = workspace.payload.data.choices.map((choice) => {
    const candidates = actions.filter(
      ({ subjectId, action }) =>
        subjectId === workspace.payload.reviewId &&
        sha256Jcs(action.arguments) === choice.choiceHash,
    );
    if (candidates.length > 1 || (capability.available && candidates.length !== 1)) return null;
    const action = candidates[0] ?? null;
    return Object.freeze({
      choice,
      action,
      locator:
        action === null
          ? null
          : Object.freeze({
              subjectId: workspace.payload.reviewId,
              actionDigest: sha256Jcs(action.action),
            }),
    });
  });
  return mapped.some((entry) => entry === null)
    ? null
    : Object.freeze(mapped as OperateReviewChoiceModel[]);
}

export function resolveOperateReviewModel(
  state: DashboardProductState<unknown>,
  currentBinding: DashboardQueryIdentity,
): OperateReviewModel | null {
  if (
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, currentBinding) ||
    !createOperateReviewDisplayValidator(currentBinding)(state.data)
  ) {
    return null;
  }
  const workspace = state.data;
  const choices = choiceModels(workspace);
  if (choices === null) return null;
  const terminal = workspace.payload.status === 'terminal';
  const presentation = terminal
    ? 'terminal'
    : state.kind === 'ready'
      ? workspace.payload.status
      : state.kind;
  const mutationEnabled =
    !terminal &&
    workspace.payload.status === 'ready' &&
    workspace.payload.mutationEnabled &&
    workspace.payload.data.capability.available &&
    choices.every(({ locator }) => locator !== null) &&
    productStateAllowsMutation(state, currentBinding);
  return Object.freeze({
    kind: 'review',
    binding: state.binding,
    workspace,
    payload: workspace.payload,
    presentation,
    choices,
    mutationEnabled,
    terminal,
  });
}
