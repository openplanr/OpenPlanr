// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnouncer } from '../src/announcer.mjs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('canvas announcements', () => {
  it('adds one visually hidden polite status region inside the stage and removes it', () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    const announcer = createAnnouncer(stage);
    const status = stage.querySelector<HTMLElement>('[role="status"]');
    if (!status) throw new Error('Canvas status region is missing');
    expect(stage.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.hidden).toBe(false);
    expect(status.style.position).toBe('absolute');
    announcer.dispose();
    expect(stage.querySelector('[role="status"]')).toBeNull();
  });

  it('writes only the latest pending message once per 500 millisecond window', async () => {
    const stage = document.createElement('div');
    const announcer = createAnnouncer(stage);
    const status = stage.querySelector('[role="status"]');
    if (!status) throw new Error('Canvas status region is missing');
    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(status.textContent ?? ''));
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    try {
      announcer.say('Zoom 125%');
      await vi.advanceTimersByTimeAsync(200);
      announcer.say('Zoom 156%');
      await vi.advanceTimersByTimeAsync(299);
      expect(status.textContent).toBe('');
      await vi.advanceTimersByTimeAsync(1);
      expect(status.textContent).toBe('Zoom 156%');
      expect(changes).toEqual(['Zoom 156%']);
      announcer.say('Edge of canvas');
      await vi.advanceTimersByTimeAsync(500);
      expect(changes).toEqual(['Zoom 156%', 'Edge of canvas']);
    } finally {
      observer.disconnect();
      announcer.dispose();
    }
  });

  it('cancels a pending message when disposed', () => {
    const stage = document.createElement('div');
    const announcer = createAnnouncer(stage);
    const status = stage.querySelector('[role="status"]');
    announcer.say('Zoom 125%');
    announcer.dispose();
    vi.advanceTimersByTime(500);
    expect(status?.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });
});
