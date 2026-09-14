/**
 * Standalone Vite test entry for browser-based dashboard tests.
 *
 * Applies browser-only presentation parameters, then imports the production
 * dashboard entry. Bootstrap and projections come through the same loopback
 * HTTP reads as the shipped application; this file never injects App props.
 */
const params = new URLSearchParams(window.location.search);

const theme = params.get('theme') ?? 'light';
const density = params.get('density') ?? 'normal';
const contrast = params.get('contrast') ?? 'normal';
const initialHash = params.get('route') ?? '#/overview';

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.setAttribute('data-density', density);
if (contrast === 'high') {
  document.documentElement.setAttribute('data-contrast', 'high');
}

if (initialHash && !window.location.hash) {
  window.location.hash = initialHash;
}

void import('../../../../../apps/dashboard/src/main.js');
