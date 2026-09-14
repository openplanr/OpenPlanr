import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';

declare const __OPENPLANR_DASHBOARD_BUILD_ID__: string;

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('OpenPlanr dashboard root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App buildId={__OPENPLANR_DASHBOARD_BUILD_ID__} />
  </StrictMode>,
);
