/** Missing legacy embeds have fallbacks; present malformed data blocks initialization. */
export function readBoardEmbeddedJson(document, id, fallback) {
  const element = document.getElementById(id);
  if (!element) return fallback;
  let value;
  try {
    value = JSON.parse(element.textContent ?? '');
  } catch {
    throw new Error(
      `Cannot initialize design board: embedded ${id} is not valid JSON. Reload a freshly rendered board.`,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      `Cannot initialize design board: embedded ${id} must be an object. Reload a freshly rendered board.`,
    );
  return value;
}
export function reportBoardInitializationError(document, error) {
  const message = error.message;
  globalThis.__OPENPLANR_ARTIFACT_STAGE_INITIALIZATION_ERROR__ = message;
  const status = document.querySelector('[data-planr-slot="status"]');
  if (status) {
    status.textContent = message;
    status.setAttribute('data-error', '');
    status.setAttribute('role', 'alert');
  }
  document.querySelector('.planr-shell')?.setAttribute('data-planr-initialization-error', '');
}
