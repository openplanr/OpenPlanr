import { Badge, CommandHint } from '../../design-system/components/index.js';

const EXAMPLE_SEATS = [
  ['CEO', 'Strategy, runway, cost of delay'],
  ['CTO', 'Architecture and delivery risk'],
  ['CPO', 'Product bets and user value'],
  ['CMO', 'Positioning, demand, retention'],
  ['COO', 'Execution and operating cadence'],
  ['CHAIR', 'Brings the reports together'],
  ['CHALLENGER', 'Tests the board’s assumptions'],
] as const;

function ExampleCycle() {
  return (
    <section className="op-example-cycle" aria-labelledby="op-example-cycle-title">
      <header className="op-example-cycle__heading">
        <Badge tone="warn" variant="outline">
          Example cycle
        </Badge>
        <p id="op-example-cycle-title">
          How Today reads once a cycle exists. Content below is illustrative, not this project’s
          data.
        </p>
      </header>
      <div className="op-example-cycle__columns">
        <div className="op-example-cycle__stack">
          <section
            className="pc-card op-example-cycle__focus"
            aria-labelledby="op-example-focus-title"
          >
            <header className="op-example-cycle__focus-header">
              <p className="op-eyebrow">Focus item</p>
              <span>Cycle [ID] · Chair synthesis</span>
            </header>
            <h2 id="op-example-focus-title">[The one decision this cycle asks for]</h2>
            <dl className="op-example-cycle__metrics">
              <div>
                <dt>Confidence in this cycle</dt>
                <dd>[level]</dd>
              </div>
              <div>
                <dt>Evidence gaps</dt>
                <dd>[n]</dd>
              </div>
              <div>
                <dt>Preserved dissent</dt>
                <dd>[n]</dd>
              </div>
            </dl>
            <p className="op-example-cycle__next">
              <strong>Next safe step:</strong> [the reversible action the Chair recommends]
            </p>
          </section>
          <section
            className="pc-card op-example-cycle__seats"
            aria-labelledby="op-example-seats-title"
          >
            <h2 id="op-example-seats-title">Executive seats</h2>
            <div className="op-example-cycle__seat-grid">
              {EXAMPLE_SEATS.map(([role, description]) => (
                <div className="op-example-cycle__seat" data-role={role.toLowerCase()} key={role}>
                  <strong>{role}</strong>
                  <p>{description}</p>
                </div>
              ))}
              <p className="op-example-cycle__seat op-example-cycle__seat--note">
                Seat reports open in the side panel
              </p>
            </div>
          </section>
        </div>
        <div className="op-example-cycle__stack">
          <section
            className="pc-card op-example-cycle__panel"
            aria-labelledby="op-example-evidence-title"
          >
            <h2 id="op-example-evidence-title">Evidence desk</h2>
            <ul className="op-example-cycle__evidence">
              <li>
                <span aria-hidden="true">◆</span>
                <p>
                  <strong>Checkpoint verified</strong> · [record]
                </p>
              </li>
              <li>
                <span aria-hidden="true">◇</span>
                <p>
                  <strong>Not proven</strong> · [claim needing evidence]
                </p>
              </li>
              <li>
                <span aria-hidden="true">◇</span>
                <p>
                  <strong>Blocker</strong> · [what stops the step]
                </p>
              </li>
            </ul>
          </section>
          <section
            className="pc-card op-example-cycle__panel"
            aria-labelledby="op-example-inbox-title"
          >
            <h2 id="op-example-inbox-title">Inbox</h2>
            <dl className="op-example-cycle__inbox">
              <div>
                <dt>Reviews</dt>
                <dd>[n]</dd>
              </div>
              <div>
                <dt>Approvals</dt>
                <dd>[n]</dd>
              </div>
              <div>
                <dt>To verify</dt>
                <dd>[n]</dd>
              </div>
            </dl>
            <p>Review decisions, approvals, and verification work.</p>
          </section>
          <section
            className="pc-card op-example-cycle__panel"
            aria-labelledby="op-example-handoff-title"
          >
            <h2 id="op-example-handoff-title">Planning handoff</h2>
            <p>
              An approved action becomes planning work. The trace links back to its cycle from the
              spec’s detail page.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}

export function OperateSetup() {
  return (
    <>
      <section className="pc-card pc-operate-setup" aria-labelledby="operate-setup-title">
        <div>
          <p className="op-eyebrow">This project, right now</p>
          <Badge tone="warn" variant="outline">
            Proposed
          </Badge>
          <h1 id="operate-setup-title">Operate is not set up here yet</h1>
          <p>
            No operating cycle has been returned for this project. Run a review cycle in your agent
            host to see its focus decision, executive perspectives, and supporting evidence here.
          </p>
        </div>
        <div>
          <CommandHint command="/planr:operate" label="Start an operating review" />
          <p>Seven executive lenses, one decision and action brief.</p>
        </div>
      </section>
      <ExampleCycle />
    </>
  );
}
