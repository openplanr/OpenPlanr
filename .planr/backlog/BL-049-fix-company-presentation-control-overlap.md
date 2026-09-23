---
id: "BL-049"
title: "Prevent controls from overlapping in artifact presentation"
priority: "medium"
tags: ["company", "review", "presentation", "responsive", "accessibility"]
status: "open"
created: "2026-09-23"
updated: "2026-09-23"
---

# BL-049: Prevent controls from overlapping in artifact presentation

## Problem

In the company artifact presentation view, the floating **Exit presentation**
control overlaps the underlying **Read screen** control in the 2026-09-23
production screenshot. This obscures both actions and makes presentation feel
unfinished, especially when viewport or browser chrome changes.

## Desired behavior

- Presentation has a single intentional control layer with reserved placement
  and safe-area spacing. Exit and content controls never occupy the same hit area.
- Controls remain reachable by pointer and keyboard, with an obvious Escape path.
- A narrow or short viewport can reposition controls without covering authored
  content or hiding the exit action.

## Acceptance criteria

1. At desktop and 390×844 phone sizes, including zoomed text and browser
   fullscreen changes, actionable controls neither overlap nor clip.
2. Escape, focus order, visible focus, and screen-reader names work for entry,
   content reading and exit.
3. A browser regression test exercises the actual company presentation route,
   not just a static component snapshot.

## Relationship

Refines SPEC-013's approved presentation behavior in the hosted company app.
