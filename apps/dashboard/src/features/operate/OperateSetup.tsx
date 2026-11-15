import { CommandHint } from '../../design-system/components/index.js';
import { OPERATE_SEATS } from './today/today-view.js';
import './today/today.css';

/** First-run Operate: the command that starts a review and the seven seats it fills. */
export function OperateSetup() {
  return (
    <div className="pc-operate-today">
      <section
        className="pc-operate-today__card pc-operate-setup"
        aria-labelledby="operate-setup-title"
      >
        <div className="pc-operate-setup__copy">
          <h1 id="operate-setup-title">Operate is not set up in this project</h1>
          <p>
            Seven executive lenses review the project and leave one decision and action brief. Run
            the first review to fill this page.
          </p>
        </div>
        <CommandHint command="/planr:operate" />
      </section>
      <section
        className="pc-operate-today__card pc-operate-today__seats pc-operate-setup__seats"
        aria-label="Executive seats"
      >
        <header className="pc-operate-today__card-head">
          <h2>Executive seats</h2>
        </header>
        <ul>
          {OPERATE_SEATS.map(([name, focus]) => (
            <li key={name} className="pc-operate-today__seat">
              <span className="pc-operate-today__seat-name">{name}</span>
              <span className="pc-operate-today__seat-focus">{focus}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
