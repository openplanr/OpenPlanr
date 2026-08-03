---
id: "TASK-015"
title: "Tasks for FEAT-015: Linear Authentication and Team Selection"

featureId: "FEAT-015"
created: "2026-04-21"
updated: "2026-04-22"
status: "done"
---

# TASK-015: Tasks for FEAT-015: Linear Authentication and Team Selection


**Feature:** [FEAT-015](../features/FEAT-015-linear-authentication-and-team-selection.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-054`
- **User Story:** `.planr/stories/US-055`
- **User Story:** `.planr/stories/US-056`
- **Gherkin:** `.planr/stories/US-054-gherkin.feature`
- **Gherkin:** `.planr/stories/US-055-gherkin.feature`
- **Gherkin:** `.planr/stories/US-056-gherkin.feature`

## Tasks

- [x] **1.0** Linear SDK Integration and Type Definitions
  - [x] 1.1 Add @linear/sdk dependency and configure Linear types in src/models/types.ts
  - [x] 1.2 Create LinearConfig interface with teamId and token fields in src/models/types.ts
- [x] **2.0** Linear Credentials Service
  - [x] 2.1 Extend src/services/credentials-service.ts to support Linear PAT storage using 'linear' provider key
  - [x] 2.2 Add PLANR_LINEAR_TOKEN to ENV_KEY_MAP in src/ai/types.ts for environment variable resolution
- [x] **3.0** Linear Service Implementation
  - [x] 3.1 Create src/services/linear-service.ts with LinearClient wrapper for authentication and team queries
  - [x] 3.2 Implement validateToken() function using Linear GraphQL viewer query
  - [x] 3.3 Implement getAvailableTeams() function to query user's accessible teams
  - [x] 3.4 Implement validateTeamAccess() function to verify project creation permissions
- [x] **4.0** Linear Init Command Implementation
  - [x] 4.1 Create src/cli/commands/linear.ts following the pattern from src/cli/commands/quick.ts
  - [x] 4.2 Implement 'planr linear init' subcommand with PAT prompt using promptSecret (masked) or PLANR_LINEAR_TOKEN
  - [x] 4.3 Add team selection logic using promptSelect for multiple teams or auto-select for single team
  - [x] 4.4 Integrate validation flow and store credentials using saveCredential from credentials-service
- [x] **5.0** Command Registration and Error Handling
  - [x] 5.1 Register Linear command in src/cli/index.ts following the pattern of other command registrations
  - [x] 5.2 Add comprehensive error handling for invalid tokens, insufficient permissions, and network failures
  - [x] 5.3 Add success confirmation message with setup completion status

## Acceptance Criteria Mapping

- [x] The token is validated and stored securely using credentials-service (US-054) → Tasks 2.1, 3.2, 4.4
- [x] The token is read from environment and validated without prompting (US-054) → Tasks 2.2, 4.2
- [x] I receive a clear error message about the invalid token and setup fails (US-054) → Tasks 3.2, 5.2
- [x] I can choose from a list of available teams and my selection is stored (US-055) → Tasks 3.3, 4.3, 4.4
- [x] The single team is automatically selected and stored without prompting (US-055) → Tasks 4.3, 4.4
- [x] I receive a clear error about insufficient permissions and setup fails (US-055) → Tasks 3.3, 5.2
- [x] I receive confirmation that Linear integration is ready and credentials are stored (US-056) → Tasks 3.4, 4.4, 5.3
- [x] I receive a specific error about missing permissions and guidance on PAT scope requirements (US-056) → Tasks 3.4, 5.2
- [x] The process completes successfully in under 90 seconds (US-056) → Tasks 4.2, 4.3, 4.4

## Relevant Files

- `src/models/types.ts` — Add LinearConfig interface and Linear-related type definitions
- `src/ai/types.ts` — Add PLANR_LINEAR_TOKEN to ENV_KEY_MAP for environment variable resolution
- `src/services/credentials-service.ts` — Extend to support Linear PAT storage with 'linear' provider key
- `src/services/linear-service.ts` — New service to handle Linear SDK integration, authentication, and team operations
- `src/cli/commands/linear.ts` — New command file implementing 'planr linear init' functionality
- `src/cli/index.ts` — Register the new Linear command following existing command registration pattern

## Notes

- PAT entry uses `promptSecret` (masked) instead of `promptText` for security; env `PLANR_LINEAR_TOKEN` bypasses the prompt.
- `planr linear push` is documented as a follow-up in EPIC-004.
