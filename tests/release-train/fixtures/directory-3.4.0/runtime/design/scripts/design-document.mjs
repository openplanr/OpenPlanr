// design-document.mjs:2068-2070, inside the exported page's theme script
export function renderDesignDocument() {
  let preference;
  try {
    preference = localStorage.getItem('openplanr.design.theme');
  } catch {}
  return preference;
}
