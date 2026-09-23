---
id: "BL-047"
title: "Verify the OpenPlanr Microsoft Entra app publisher"
priority: "high"
tags: ["company", "identity", "microsoft", "trust"]
status: "open"
created: "2026-09-23"
updated: "2026-09-23"
---

# BL-047: Verify the OpenPlanr Microsoft Entra app publisher

## Problem

The production Microsoft consent screen for OpenPlanr shows an **unverified**
publisher, even though the Entra app, Clerk connection and OpenPlanr domain were
configured. Domain ownership and a working OAuth redirect do not establish
Microsoft publisher verification. The warning weakens trust during company
onboarding. The observed screen also offers organisation-wide admin consent and
requests ongoing access, which merit a least-privilege review.

## Desired behavior

- The OpenPlanr-owned Entra tenant and app registration, rather than a personal
  account or another employer's tenant, own the production Microsoft sign-in.
- Confirm eligibility for Microsoft publisher verification: a verified Microsoft
  AI Cloud Partner Program account and Partner One ID, matching verified publisher
  domain, and the required Entra and Partner Center administrator roles.
- Complete Entra **App registrations → Branding & properties → Publisher domain →
  Add Partner ID to verify publisher** when eligible. If a prerequisite is missing,
  record the exact blocker and owner; do not claim verification or use another
  organisation's partner identity as a shortcut.
- Review requested Microsoft scopes and the administrator-consent journey with
  Clerk's production configuration. Explain organisation-wide consent only when
  it is actually needed; retain the minimum scopes required for sign-in.

## Acceptance criteria

1. The registration, tenant, verified domain, Partner One ID and role ownership
   are recorded without publishing secrets or personal account details.
2. A fresh Microsoft work-account sign-in displays OpenPlanr as a verified
   publisher, or the item remains open with the verified Microsoft prerequisite
   that blocks it.
3. The production consent screen's permissions and admin-consent behavior are
   documented and tested for both an ordinary user and a tenant administrator.

## Boundary

This is a hosted identity configuration item under ADR-021. It does not change
public Protocol or local skill behavior. Never store client secrets here.
