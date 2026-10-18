import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { loadDashboardFonts } from './design-system/fonts.js';

declare const __OPENPLANR_DASHBOARD_BUILD_ID__: string;

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('OpenPlanr dashboard root element is missing.');

void loadDashboardFonts(document.fonts)
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <App buildId={__OPENPLANR_DASHBOARD_BUILD_ID__} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.setAttribute('role', 'alert');
    root.textContent = 'Dashboard fonts could not load. Reload to retry the local assets.';
    throw error;
  });
