import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { loadDashboardFonts } from './design-system/fonts.js';

declare const __OPENPLANR_DASHBOARD_BUILD_ID__: string;

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('OpenPlanr dashboard root element is missing.');

const renderApp = (fontLoadFailed = false) => {
  createRoot(root).render(
    <StrictMode>
      <App buildId={__OPENPLANR_DASHBOARD_BUILD_ID__} fontLoadFailed={fontLoadFailed} />
    </StrictMode>,
  );
};

void loadDashboardFonts(document.fonts).then(
  () => renderApp(),
  (error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: missing local faces must remain diagnosable after startup.
    console.error('Dashboard fonts could not load; continuing with fallback fonts.', error);
    renderApp(true);
  },
);
