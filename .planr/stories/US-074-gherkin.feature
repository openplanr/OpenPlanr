Feature: Error handling with actionable guidance
  US-074 - As a As a user, I want to I want clear error messages with actionable guidance when sync operations fail so that So that I can quickly resolve issues and complete my sync operations

  Background:
    Given the system is initialized

  Scenario: Authentication error with guidance
    Given My Linear PAT is invalid or expired
    When I run a sync command
    Then I see an error message explaining the auth issue and how to fix it with 'planr linear init'

  Scenario: Network error with retry suggestion
    Given Linear API is temporarily unavailable
    When I run a sync command
    Then I see an error message suggesting to retry and check Linear status page

  Scenario: Rate limit error with wait time
    Given I hit Linear API rate limits
    When I run a sync command
    Then I see an error message with estimated wait time before retrying

