---
id: SPEC-900
title: Design sample (conformance fixture)
slug: design-sample
schemaVersion: "1.0.0"
status: ready-for-pipeline
priority: medium
---

# Design sample — conformance fixture for `/planr-pipeline:design`

A small UI-facing feature used to exercise the design generation flow. It deliberately has
a `## Screens` section (so `lib/design/screens.mjs` resolves a non-zero screen list) and a
recognizable mix so the format-recommendation rule has something to chew on.

## Context & Goal

A personal dashboard where a user signs in, lands on a "Today" overview, and drills into
budget and habit trackers.

## Screens

- Login — email + password, "forgot password" link
- Today — greeting, today's tasks, streaks, savings progress
- Budget — spend vs budget chart, category breakdown
- Habits — habit grid, completion ring
- Settings — profile, spaces, theme toggle

## Out of scope

- Real authentication backend
- Data persistence

## Acceptance criteria

- Running `/planr-pipeline:design design-sample` with `--from spec` produces a design
  artifact + `finalized.json` (validating against `schemas/v1.0.0/design-manifest.schema.json`)
  + `design-spec.md` with all 10 sections.
- With 5 screens in a linear flow, the recommended format is **walkthrough**
  (`lib/design/recommendFormat.mjs`).
