import { createContext, type ReactNode, useContext } from 'react';
import { CopyDetailValue } from './PlanningDetailActions.js';
import {
  type PlanningModelNode,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
} from './planning-model.js';
import type { StructuralReference } from './planning-structural-model.js';

const CLOSED = ['done', 'addressed'];

/** True while the command is docked in the bar above the phone navigation. */
export const NextStepDocked = createContext(false);

function IdLink({ node }: { node: PlanningModelNode }) {
  const href = planningDetailHref(node);
  const id = planningDisplayId(node);
  return href ? (
    <a className="pc-detail__inline-id" href={href}>
      {id}
    </a>
  ) : (
    <code className="pc-detail__inline-id">{id}</code>
  );
}

function joined(nodes: readonly PlanningModelNode[]): ReactNode {
  if (nodes.length === 1) return <IdLink node={nodes[0]} />;
  if (nodes.length === 2)
    return (
      <>
        <IdLink node={nodes[0]} /> and <IdLink node={nodes[1]} />
      </>
    );
  return (
    <>
      <IdLink node={nodes[0]} /> and {nodes.length - 1} more
    </>
  );
}

/** The sentence and command for what to do next with this item. */
export function nextStep(
  node: PlanningModelNode,
  dependencies: readonly StructuralReference[],
): { sentence: ReactNode; command: string | null } {
  const type = node.type === 'spec' ? 'spec' : node.type === 'story' ? 'story' : 'task';
  const missing = dependencies.find((ref) => !ref.node);
  if (missing)
    return {
      sentence: `${missing.reference} is listed under Depends on but no item has that ID. Fix the reference in the ${type} file.`,
      command: null,
    };
  const open = dependencies.flatMap((ref) =>
    ref.node && !CLOSED.includes(ref.node.status) ? [ref.node] : [],
  );
  if (open.length && !CLOSED.includes(node.status))
    return {
      sentence: (
        <>
          Finish {joined(open)} first; this {type} starts when{' '}
          {open.length === 1 ? 'it is' : 'they are'} done.
        </>
      ),
      command: planningContinuation(open[0]),
    };
  const id = planningDisplayId(node);
  if (node.type === 'task' || node.type === 'quick') {
    if (CLOSED.includes(node.status)) return { sentence: `${id} is done.`, command: null };
    return {
      sentence:
        node.status === 'in-progress'
          ? `${id} is in progress. Continue shipping it.`
          : `Nothing blocks ${id}. Ship it next.`,
      command: planningContinuation(node),
    };
  }
  return { sentence: `Read where ${id} stands.`, command: planningContinuation(node) };
}

export function DetailNextStep({
  node,
  dependencies,
}: {
  node: PlanningModelNode;
  dependencies: readonly StructuralReference[];
}) {
  const step = nextStep(node, dependencies);
  const docked = useContext(NextStepDocked);
  return (
    <section className="pc-card pc-detail__next-card" aria-label="Next step">
      <header className="pc-card__head pc-card__header">
        <h2 className="pc-card__title">Next step</h2>
      </header>
      <div className="pc-detail__next-body">
        <p>{step.sentence}</p>
        {step.command && !docked ? (
          <>
            <code className="pc-detail__command">{step.command}</code>
            <CopyDetailValue value={step.command} label="Copy command" icon={null} />
          </>
        ) : null}
      </div>
    </section>
  );
}
