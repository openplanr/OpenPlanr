// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  operateLiveOrigin,
  operateLiveReadsEnabled,
  shouldPreferOperateLiveRoute,
} from '../../../../apps/dashboard/src/features/operate/operate-live.js';

const ORIGINAL_LOCATION = window.location;

function setLocation(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: Object.freeze({
      origin: parsed.origin,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    }),
  });
}

describe('operate live origin helpers', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: ORIGINAL_LOCATION,
    });
  });

  it('accepts only exact loopback dashboard roots without query or hash', () => {
    setLocation('http://127.0.0.1:7473/');
    expect(operateLiveOrigin()).toBe('http://127.0.0.1:7473');
    expect(operateLiveReadsEnabled()).toBe(true);

    setLocation('http://localhost:7473/');
    expect(operateLiveOrigin()).toBe('http://localhost:7473');

    setLocation('http://127.0.0.1:7473/#/operate/inbox');
    expect(operateLiveOrigin()).toBe('');

    setLocation('http://127.0.0.1:7473/?scopeId=scope');
    expect(operateLiveOrigin()).toBe('');

    setLocation('https://127.0.0.1:7473/');
    expect(operateLiveOrigin()).toBe('');
  });

  it('prefers live routes only when loopback reads are enabled and connected', () => {
    setLocation('http://127.0.0.1:7473/');
    expect(shouldPreferOperateLiveRoute(true, 'booting')).toBe(false);
    expect(shouldPreferOperateLiveRoute(false, 'booting')).toBe(false);
    expect(shouldPreferOperateLiveRoute(true, 'connected')).toBe(true);
    expect(shouldPreferOperateLiveRoute(true, 'read-only')).toBe(true);
    expect(shouldPreferOperateLiveRoute(false, 'connected')).toBe(true);
    expect(shouldPreferOperateLiveRoute(true, 'offline')).toBe(false);

    setLocation('https://example.test/');
    expect(shouldPreferOperateLiveRoute(true, 'connected')).toBe(false);
  });
});
