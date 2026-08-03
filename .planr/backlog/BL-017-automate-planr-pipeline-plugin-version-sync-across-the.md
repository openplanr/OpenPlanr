---
id: "BL-017"
title: "Automate openplanr-pipeline plugin version sync across the..."
priority: "medium"
tags: ["tech-debt", "automation", "ecosystem"]
status: "open"
created: "2026-04-29"
updated: "2026-04-29"
---

# BL-017: Automate openplanr-pipeline plugin version sync across the...

## Priority
MEDIUM

## Tags

- tech-debt
- automation
- ecosystem

## Description
Automate openplanr-pipeline plugin version sync across the 4-repo ecosystem (planr CLI marketplace pin, skills CHANGELOG cross-references). Add a GitHub Action triggered by repository_dispatch from openplanr-pipeline release workflow that auto-opens a changeset PR in OpenPlanr and a marketplace-pin PR in openplanr-marketplace. Eliminates the 3-place manual sync that currently happens on every pipeline release. Generated rule files no longer reference pipeline plugin version (resolved in v1.5.0 — they now reference OpenPlanr Protocol v1.0.0 instead, which is a runtime-agnostic stable contract). The remaining sync is the marketplace pin file. Tier this in 3 levels: (1) GitHub Action with repository_dispatch (~1hr), (2) consider extracting OPENPLANR_PROTOCOL_VERSION to a shared constants package once 2+ consumers exist, (3) full release-coordination workflow that fans out version bumps to all dependent repos with auto-merge for chore PRs. Reference the original Option-2 design discussed in the multi-runtime compatibility plan.



---
_Promote to agile hierarchy: `planr backlog promote BL-017 --story` or `planr backlog promote BL-017 --quick`_
_Close when done: `planr backlog close BL-017`_
