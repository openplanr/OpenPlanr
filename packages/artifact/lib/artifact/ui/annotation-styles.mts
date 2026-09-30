/** Canonical passive review overlays and the accessible annotation composer. */
export const ARTIFACT_ANNOTATION_CSS = `.planr-annotation-layer { position: absolute; z-index: 6; inset: 0; }
.planr-shell[data-planr-review-mode="interact"] .planr-annotation-layer { pointer-events: none; }
.planr-shell[data-planr-review-mode="comment"] .planr-annotation-layer { cursor: crosshair; touch-action: none; }
.planr-shell[data-planr-review-mode="comment"] .planr-frame iframe { pointer-events: none; }
.planr-region-selection {
  position: absolute;
  min-width: 2px;
  min-height: 2px;
  border: 2px solid var(--planr-color-primary);
  border-radius: var(--planr-radius-small);
  background: color-mix(in srgb, var(--planr-color-primary) 14%, transparent);
  pointer-events: none;
}
.planr-pin {
  position: absolute;
  z-index: 8;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  translate: -50% -50%;
  display: grid;
  place-items: center;
  padding: 0;
  border: 8px solid transparent;
  border-radius: 50%;
  background-clip: padding-box;
  color: var(--planr-color-on-danger);
  cursor: pointer;
  pointer-events: auto;
  font: 700 10px/1 var(--planr-font-mono);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--planr-color-background) 38%, transparent);
}
.planr-pin-fix { background-color: var(--planr-color-danger); }
.planr-pin-improve { background-color: var(--planr-color-primary-strong); color: var(--planr-color-on-improve); }
.planr-pin-question { background-color: var(--planr-color-question); color: var(--planr-color-on-question); }
.planr-pin-resolved, .planr-pin-addressed { background-color: var(--planr-color-resolved); color: var(--planr-color-on-resolved); }
.planr-pin-highlight { animation: planr-pin-highlight 1.2s ease-out; }
@keyframes planr-pin-highlight {
  0%, 35% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--planr-color-primary) 52%, transparent), 0 4px 14px color-mix(in srgb, var(--planr-color-background) 38%, transparent); }
  100% { box-shadow: 0 4px 14px color-mix(in srgb, var(--planr-color-background) 38%, transparent); }
}
.planr-pin-region {
  position: absolute;
  z-index: 7;
  min-width: 2px;
  min-height: 2px;
  border: 2px solid var(--planr-color-danger);
  border-radius: var(--planr-radius-small);
  background: color-mix(in srgb, var(--planr-color-danger) 12%, transparent);
  pointer-events: none;
}
.planr-pin-region-improve { border-color: var(--planr-color-primary-strong); background: color-mix(in srgb, var(--planr-color-primary-strong) 12%, transparent); }
.planr-pin-region-question { border-color: var(--planr-color-question); background: color-mix(in srgb, var(--planr-color-question) 12%, transparent); }
.planr-pin-region-resolved, .planr-pin-region-addressed { border-color: var(--planr-color-resolved); background: color-mix(in srgb, var(--planr-color-resolved) 10%, transparent); }
.planr-annotation-composer {
  position: fixed;
  inset: auto;
  z-index: 100;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 24px));
  max-height: min(620px, calc(100dvh - 24px));
  margin: 0;
  overflow: auto;
  overscroll-behavior: contain;
  translate: none;
  transform: none;
  padding: 14px;
  border: 1px solid var(--planr-color-rule);
  border-radius: var(--planr-radius-large);
  background: var(--planr-color-panel);
  color: var(--planr-color-text);
  box-shadow: 0 18px 60px color-mix(in srgb, var(--planr-color-background) 58%, transparent);
  cursor: default;
  pointer-events: auto;
}
.planr-annotation-composer strong { display: block; margin: 0; font: 650 14px/1.2 var(--planr-font-display); }
.planr-composer-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.planr-composer-header button { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: var(--planr-radius-small); background: transparent; color: var(--planr-color-text-muted); font: 22px/1 var(--planr-font-body); cursor: pointer; }
.planr-composer-header button:hover { background: var(--planr-color-raised); color: var(--planr-color-text); }
.planr-annotation-composer :focus-visible { outline: 2px solid var(--planr-color-primary); outline-offset: 2px; }
.planr-annotation-composer::backdrop { background: transparent; pointer-events: none; }
.planr-annotation-composer label, .planr-identity label {
  display: grid;
  gap: 5px;
  margin-bottom: 9px;
  color: var(--planr-color-text-muted);
  font-size: 11px;
}
.planr-annotation-composer input, .planr-annotation-composer textarea, .planr-identity input,
.planr-reply-form textarea {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--planr-color-rule);
  border-radius: var(--planr-radius-small);
  background: var(--planr-color-chrome);
  color: var(--planr-color-text);
}
.planr-annotation-composer textarea { min-height: 84px; resize: vertical; }
.planr-intent-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 9px; }
.planr-intent-picker button {
  min-height: 30px;
  border: 1px solid var(--planr-color-rule);
  border-radius: var(--planr-radius-small);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
}
.planr-intent-picker [aria-checked="true"] { border-color: var(--planr-color-primary); background: var(--planr-color-raised); }
.planr-field-error { min-height: 16px; margin: 0; color: var(--planr-color-danger); font-size: 10px; }
.planr-composer-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 8px; }
.planr-composer-actions button, .planr-thread button, .planr-reply-form button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--planr-color-rule);
  border-radius: var(--planr-radius-small);
  background: transparent;
  cursor: pointer;
  font-weight: 700;
}
.planr-composer-actions [type="submit"], .planr-reply-form [type="submit"] { border-color: var(--planr-color-primary); background: var(--planr-color-primary); color: var(--planr-color-background); }
`;

/** Mobile form controls stay readable without browser input zoom. */
export const ARTIFACT_ANNOTATION_MOBILE_CSS = `@media (max-width: 600px) { .planr-annotation-composer input, .planr-annotation-composer textarea, .planr-annotation-composer select { font-size: 16px; } }`;
