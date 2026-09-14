# Dashboard Accessibility Evidence Checklist

> Last updated: 2026-08-20

Status: **automated closure evidence complete; manual certification not claimed**.
On 2026-08-20 the product owner accepted VoiceOver, NVDA, and physical-device
testing as a non-blocking limitation for SPEC-020. The unchecked journeys below
remain a future human-validation checklist; they are neither marked passed nor
represented as release evidence.

This document separates the remaining human evidence from browser-automated
checks. Manual release evidence is limited to VoiceOver, NVDA, and real touch
devices; those checks require a human tester using the named assistive technology
or hardware.

Automated browser evidence is produced by
`tests/e2e/dashboard-visual-regression.test.ts` against the Vite-served real
dashboard fixture. It waits for owner-issued ready Planning and Operate data,
then runs axe, keyboard, governed-dialog focus return, route-announcement,
emulated-touch, viewport, 200% effective reflow, forced-colors, reduced-motion,
hostile-content, and native screenshot checks. Reviewed Playwright golden PNGs cover Planning,
Operate, the governed dialog, 1440/1024/768/390/320 layouts, and the combined
forced-colors/reduced-motion state. `toHaveScreenshot` compares those stable
baselines on every run without an auto-update flag; the complete route inventory
also emits PNG attachments for diagnosis. Neither form is represented by
placeholder hashes or treated as manual assistive-technology approval.

## Scope

All primary Planning and Operate journeys as defined by
`DASHBOARD_ROUTE_DEFINITIONS` in `apps/dashboard/src/app/router.tsx`.

---

## Manual Test Setup and Evidence Template

If a future human validation session is commissioned, complete this block once
for each tester, assistive technology, browser, and physical device before
checking any row below.

| Field | Record |
|-------|--------|
| Dashboard build / commit | |
| Test URL and data source | |
| Tester | |
| Date and local time zone | |
| Device and operating-system version | |
| Browser and version | |
| Assistive technology and version, if applicable | |
| Known limitations or deviations | |

Only mark an individual journey verified after the tester completes it on the
recorded setup and writes the observed result in **Notes**. Playwright,
emulated touch, axe, screenshots, and responsive checks are useful automated
evidence, but do not populate a manual row or substitute for screen-reader
speech or physical-device validation.

---

## VoiceOver Journeys (macOS)

| Journey | Verified | Date | Tester | Notes |
|---------|----------|------|--------|-------|
| Navigate to Overview via skip-link | [ ] | | | |
| Browse Planning Graph table alternative | [ ] | | | |
| Open command palette (Cmd+K), search, select | [ ] | | | |
| Navigate Operate Today cockpit | [ ] | | | |
| Read Cycle detail and executive board | [ ] | | | |
| Review Inbox decision item | [ ] | | | |
| Inspect Action detail boundaries | [ ] | | | |
| Navigate Recovery inspection | [ ] | | | |
| Browse Evidence, Outcomes, History lists | [ ] | | | |

## VoiceOver Journeys (iOS Safari)

| Journey | Verified | Date | Tester | Notes |
|---------|----------|------|--------|-------|
| Complete overview-to-action flow with swipe | [ ] | | | |
| Command palette via touch (no keyboard shortcut) | [ ] | | | |

## NVDA Journeys (Windows)

| Journey | Verified | Date | Tester | Notes |
|---------|----------|------|--------|-------|
| Navigate Planning and Operate landmarks | [ ] | | | |
| Read the Planning Graph table alternative | [ ] | | | |
| Open and close the command palette | [ ] | | | |
| Open and cancel a governed Action confirmation | [ ] | | | |
| Verify route-change announcements | [ ] | | | |

## Automated 200% Reflow Evidence

Playwright creates a 1440×900 screen with a 720×450 CSS-pixel viewport and
`deviceScaleFactor: 2`, loads verified Operate Today data, and asserts the 2×
scale, no page-width overflow, no active target below 44×44 CSS pixels, visible
ready-state content, and a native screenshot attachment. The test uses neither
CSS `zoom` nor `transform: scale()`.

## Real Touch Device Testing

| Device | Browser | Verified | Date | Notes |
|--------|---------|----------|------|-------|
| iPhone (latest iOS Safari) | Safari | [ ] | | |
| iPad | Safari | [ ] | | |
| Android phone (Chrome) | Chrome | [ ] | | |

Expected: 44px minimum touch targets, no hover-only interactions, no
viewport-width overflow.

## Screen Reader Announcement Quality

Automated tests verify announcement presence but not quality. Human testers
should verify:

- Route changes announced via polite live region without focus theft
- Dialog content (command palette, confirmation) read in correct order
- Graph table alternative gives equivalent information to visual graph
- StatePanel messages convey the correct severity
- No phantom announcements or stale content in the live region

## High Contrast and Forced Colors

Automated Chromium evidence enables `forced-colors: active` together with the
dashboard high-contrast token, confirms the media query is active, runs axe on
the ready Inbox surface, and attaches a native screenshot.

## Reduced Motion

Automated Chromium evidence enables `prefers-reduced-motion: reduce` on the ready
Inbox surface and verifies `--op-motion-duration: 0.01ms` before screenshot and
axe checks.
