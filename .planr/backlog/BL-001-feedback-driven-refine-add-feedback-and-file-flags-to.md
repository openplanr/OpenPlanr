---
id: "BL-001"
title: "Feedback-driven refine: add --feedback and --file flags to..."
priority: "high"
tags: ["feature", "refine", "dx"]
status: "open"
created: "2026-04-11"
updated: "2026-04-11"
---

# BL-001: Feedback-driven refine: add --feedback and --file flags to...

## Priority
HIGH

## Tags

- feature
- refine
- dx

## Description
Feedback-driven refine: add --feedback and --file flags to planr refine command so users can pass external evaluation, review notes, or gap analysis documents to guide AI refinement. Supports cascade mode where feedback propagates down the artifact hierarchy. Use case: user gets a code review or planning evaluation, passes it to planr refine EPIC-001 --file feedback.md --cascade, and all artifacts are refined according to the feedback.



---
_Promote to agile hierarchy: `planr backlog promote BL-001 --story` or `planr backlog promote BL-001 --quick`_
_Close when done: `planr backlog close BL-001`_
