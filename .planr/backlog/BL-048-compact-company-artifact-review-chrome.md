---
id: "BL-048"
title: "Consolidate the company artifact review header and canvas chrome"
priority: "high"
tags: ["company", "review", "design", "responsive", "accessibility"]
status: "open"
created: "2026-09-23"
updated: "2026-09-23"
---

# BL-048: Consolidate the company artifact review header and canvas chrome

## Problem

The company reviewer for **Adatalabs — The Business Brain** repeats the artifact
title and metadata in stacked top bars: project/action chrome, artifact title and
revision, then the same screen title and size. This consumes canvas height and
weakens the hierarchy of the primary review surface. Similar density was
observed in the earlier ACME design review. The 2026-09-23 screenshots show the
current production state; a prior compact-workspace implementation did not
resolve this instance.

## Desired behavior

- One clear, compact hierarchy for project identity, artifact identity, revision,
  screen/frame selection and essential actions. Do not repeat the same title in
  adjacent bars when one artifact contains one frame.
- Use contextual controls only when multiple screens, variants or viewports make
  them relevant. Keep the canvas and Discussion / Inspect / Revisions rail aligned.
- Preserve project navigation, access state, review actions, keyboard navigation
  and responsive mobile behavior.

## Acceptance criteria

1. Single-frame documents and multi-frame designs each have a deliberate header
   state, with no redundant adjacent title/metadata row.
2. At 1440×1024 and 390×844, the content canvas gets the available vertical space
   without clipped controls or unintended page-level scrolling.
3. Browser and visual checks cover both light and dark themes, long titles,
   narrow widths, focus order, and the open review rail. No access or review
   action disappears.

## Relationship

Refines the approved company review surface in SPEC-013. Hosted UI source and
deployment remain in the private `openplanr-web` repository per ADR-021.
