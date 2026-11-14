import { useId } from 'react';
import './today.css';

/** Today when nothing waits: the headline carries the state and no decision card is drawn. */
export function NothingWaiting({ summary }: { summary: string }) {
  return (
    <div className="pc-operate-today">
      <div className="pc-operate-today__heading">
        <h1 className="pc-operate-today__title">Nothing needs you today</h1>
        <p className="pc-operate-today__summary">{summary}</p>
      </div>
    </div>
  );
}

/** Today when its source could not be read; it shows what failed and no data from that source. */
export function CouldNotRead({ title, reason }: { title: string; reason: string }) {
  const titleId = useId();
  return (
    <div className="pc-operate-today">
      <section
        className="pc-operate-today__card pc-operate-today__unread"
        aria-labelledby={titleId}
      >
        <h1 id={titleId}>{title}</h1>
        <p>{reason}</p>
      </section>
    </div>
  );
}
