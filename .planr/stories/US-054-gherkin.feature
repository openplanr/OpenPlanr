Feature: Linear PAT Authentication Setup
  US-054 - As a As a product manager, I want to I want to authenticate with Linear using my Personal Access Token so that So that I can securely connect OpenPlanr to my Linear workspace

  Background:
    Given the system is initialized

  Scenario: Successful PAT authentication via prompt
    Given I have a valid Linear Personal Access Token
    When I run 'planr linear init' and enter my PAT at the secure prompt
    Then The token is validated and stored securely using credentials-service

  Scenario: PAT authentication via environment variable
    Given I have set PLANR_LINEAR_TOKEN environment variable with a valid PAT
    When I run 'planr linear init'
    Then The token is read from environment and validated without prompting

  Scenario: Invalid PAT rejection
    Given I provide an invalid or expired Linear PAT
    When I run 'planr linear init'
    Then I receive a clear error message about the invalid token and setup fails

