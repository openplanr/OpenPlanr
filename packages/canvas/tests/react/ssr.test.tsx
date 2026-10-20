// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ChromeProvider,
  formatShortcut,
  useChrome,
  useReducedMotion,
  useShortcut,
} from '../../src/react/chrome-provider.mjs';
import { OutlinePanel } from '../../src/react/outline-panel.mjs';
import { CanvasProvider, useCamera, useCanvas } from '../../src/react/provider.mjs';
import { CanvasStage } from '../../src/react/stage.mjs';
import { WorldNodes } from '../../src/react/world-nodes.mjs';

describe('React server rendering', () => {
  it('renders every component and hook with no window global', () => {
    expect(typeof window).toBe('undefined');
    function Hooks() {
      const canvas = useCanvas();
      const camera = useCamera((value) => value);
      const chrome = useChrome();
      const shortcut = useShortcut('menu');
      const reducedMotion = useReducedMotion();
      expect(canvas).toBeNull();
      expect(camera).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(chrome.chromeHidden).toBe(false);
      expect(reducedMotion).toBe(false);
      return <output>{formatShortcut(shortcut, 'linux')}</output>;
    }
    const html = renderToString(
      <ChromeProvider>
        <CanvasProvider label="Server canvas">
          <CanvasStage>
            <WorldNodes data={new Map()} renderNode={(id) => id} />
          </CanvasStage>
          <OutlinePanel
            ids={['a']}
            label="Server outline"
            height={100}
            rowHeight={28}
            renderRow={(id) => id}
          />
          <Hooks />
        </CanvasProvider>
      </ChromeProvider>,
    );
    expect(html).toContain('canvas-stage');
    expect(html).toContain('Server outline');
    expect(formatShortcut({ code: 'KeyZ', altKey: true }, 'linux')).toBe('Alt+Z');
    expect(typeof window).toBe('undefined');
  });
});
