import { Badge, CommandHint } from '../../design-system/components/index.js';

export function OperateSetup() {
  return (
    <section className="pc-card pc-operate-setup" aria-labelledby="operate-setup-title">
      <div>
        <Badge tone="warn" variant="outline">
          Proposed
        </Badge>
        <h2 id="operate-setup-title">Operate is not set up here yet</h2>
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
  );
}
