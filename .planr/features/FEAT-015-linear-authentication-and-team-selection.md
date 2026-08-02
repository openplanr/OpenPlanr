---
id: "FEAT-015"
title: "Linear Authentication and Team Selection"
epicId: "EPIC-004"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# FEAT-015: Linear Authentication and Team Selection

**Epic:** [EPIC-004](../epics/EPIC-004-linear-integration-full-hierarchy-push-bidirectional-sync.md)

## Overview
Implements `planr linear init` command for PAT authentication and team selection. Provides guided setup flow with validation and credential storage using existing credentials service.

## Functional Requirements

- Accept Linear Personal Access Token via secure prompt or environment variable
- Query and display available teams for user selection
- Validate PAT permissions and team access before storing credentials
- Store team ID and validated PAT using existing credentials-service.ts
- Provide clear error messages for invalid tokens or insufficient permissions

## User Stories

- [US-054: Linear PAT Authentication Setup](../stories/US-054-linear-pat-authentication-setup.md)
- [US-055: Linear Team Selection](../stories/US-055-linear-team-selection.md)
- [US-056: Linear Integration Setup Validation](../stories/US-056-linear-integration-setup-validation.md)

## Dependencies
Existing credentials-service.ts for secure PAT storage

## Technical Considerations
@linear/sdk GraphQL client for team queries and permission validation

## Risks
PAT scope permissions causing cryptic authentication errors

## Success Metrics
Authentication and team selection completes in under 90 seconds for new users
