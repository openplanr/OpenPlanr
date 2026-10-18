// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRoot, render } = vi.hoisted(() => {
  const render = vi.fn();
  return { createRoot: vi.fn(() => ({ render })), render };
});

vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('../../../../apps/dashboard/src/app/App.js', () => ({ App: () => null }));

const requests = [
  ...[400, 500, 600, 700, 800].map((weight) => `${weight} 14px Outfit`),
  ...[400, 500, 600].map((weight) => `${weight} 14px "DM Sans Variable"`),
  ...[400, 500, 600].map((weight) => `${weight} 12px "Source Code Pro"`),
];

const reportError = vi.fn();
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const load = vi.fn<(font: string) => Promise<object[]>>();

async function startDashboard() {
  await import('../../../../apps/dashboard/src/main.js');
  await vi.advanceTimersByTimeAsync(0);
}

function expectRendered(fontLoadFailed: boolean) {
  expect(createRoot).toHaveBeenCalledExactlyOnceWith(document.querySelector('#root'));
  expect(render).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0]?.[0].props.children.props).toEqual({
    buildId: 'font-startup-test',
    fontLoadFailed,
  });
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('__OPENPLANR_DASHBOARD_BUILD_ID__', 'font-startup-test');
  vi.spyOn(console, 'error').mockImplementation(reportError);
  document.body.innerHTML = '<div id="root"></div>';
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
  load.mockImplementation(async () => [{}]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.body.innerHTML = '';
});

describe('dashboard font startup', () => {
  it('waits for every local face before the normal first render', async () => {
    let release!: (faces: object[]) => void;
    const pending = new Promise<object[]>((resolve) => {
      release = resolve;
    });
    load.mockImplementation((font) => (font === requests[7] ? pending : Promise.resolve([{}])));
    await startDashboard();
    expect(load.mock.calls.map(([font]) => font)).toEqual(requests);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2999);
    expect(render).not.toHaveBeenCalled();
    release([{}]);
    await vi.advanceTimersByTimeAsync(0);
    expectRendered(false);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('renders with a notice and reports every failed or missing face', async () => {
    load.mockImplementation(async (font) => {
      if (font === requests[0]) throw new Error('Local asset failed');
      return font === requests[10] ? [] : [{}];
    });
    await startDashboard();
    expectRendered(true);
    expect(reportError).toHaveBeenCalledTimes(1);
    const error = reportError.mock.calls[0]?.[1];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(requests[0]);
    expect(error.message).toContain(requests[10]);
    expect(error.message).toContain('Local asset failed');
    expect(error.message).not.toContain(requests[1]);
    expect(document.querySelector('#root')?.hasAttribute('role')).toBe(false);
  });

  it('renders if the font loading API throws synchronously', async () => {
    load.mockImplementation(() => {
      throw new Error('Font loading unavailable');
    });
    await startDashboard();
    expectRendered(true);
    expect(reportError).toHaveBeenCalledTimes(1);
    const error = reportError.mock.calls[0]?.[1];
    for (const font of requests) expect(error.message).toContain(font);
  });

  it('renders with a notice when the font loading API is unavailable', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
    await startDashboard();
    expectRendered(true);
    expect(load).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    const error = reportError.mock.calls[0]?.[1];
    for (const font of requests) expect(error.message).toContain(font);
  });

  it.each(['resolve', 'reject'])(
    'renders after 3 seconds and ignores a late %s',
    async (settlement) => {
      let release!: (faces: object[]) => void;
      let reject!: (error: Error) => void;
      const pending = new Promise<object[]>((resolve, rejectPromise) => {
        release = resolve;
        reject = rejectPromise;
      });
      load.mockImplementation((font) => (font === requests[4] ? pending : Promise.resolve([{}])));
      await startDashboard();
      await vi.advanceTimersByTimeAsync(2999);
      expect(render).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expectRendered(true);
      const error = reportError.mock.calls[0]?.[1];
      expect(error.message).toContain('timed out after 3000 ms');
      expect(error.message).toContain(requests[4]);
      expect(error.message).not.toContain(requests[0]);
      if (settlement === 'resolve') release([{}]);
      else reject(new Error('Late local asset failure'));
      await vi.advanceTimersByTimeAsync(3000);
      expectRendered(true);
      expect(reportError).toHaveBeenCalledTimes(1);
    },
  );
});
