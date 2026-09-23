---
id: "BL-050"
title: "Preserve complex HTML artifact meaning in company review"
priority: "high"
tags: ["company", "artifacts", "review", "html", "fidelity", "security"]
status: "open"
created: "2026-09-23"
updated: "2026-09-23"
---

# BL-050: Preserve complex HTML artifact meaning in company review

## Problem

The same **Adatalabs — The Business Brain** artifact shows its metrics, stages,
nodes and connections on the hosted share surface, but its company review
workspace displays only the heading, a few filters and footer. Most of the
meaningful diagram is missing. The 2026-09-23 production screenshots provide a
clear before/after comparison. The real share URL contains access material and
must not be copied into public fixtures or issue text.

The company HTML adapter intentionally removes active scripts and external
navigation under SPEC-013. This item is about preserving reviewable meaning,
not executing an uploaded application with company privileges.

## Desired behavior

- Diagnose whether the lost content is script-generated, filtered by the
  sanitizer, omitted during packaging, or hidden by the canvas viewport.
- Define a safe publication path for complex artifacts: a self-contained static
  snapshot, certified portable render data, or an explicitly isolated preview
  that retains the established security boundary.
- If fidelity cannot be achieved, show a clear unsupported-content state and
  route to an authorized source/share view; never show a partial page as though
  it were the complete artifact.

## Acceptance criteria

1. A sanitized synthetic fixture with the same structural complexity renders
   its core metrics, stages, nodes and connections in company review, or clearly
   reports which parts cannot be reviewed there.
2. The result preserves readable text, responsive layout, review context and
   whole-artifact feedback at desktop and phone sizes.
3. Security tests confirm uploaded scripts, network requests and navigation
   cannot gain company-session authority. The implementation does not re-use the
   live share access fragment as a test credential.
4. A browser comparison checks published share, company canvas and presentation
   for meaningful-content parity and identifies intentional differences.

## Relationship

Extends the safe HTML/SVG review boundary documented in SPEC-013 and ADR-021;
it does not change the native semantic Diagram Studio contract in SPEC-015.
