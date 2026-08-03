Feature: Linear Integration Setup Validation
  US-056 - As a As a product manager, I want to I want to verify my Linear integration is properly configured so that So that I can confidently proceed with pushing OpenPlanr hierarchies to Linear

  Background:
    Given the system is initialized

  Scenario: Complete setup validation success
    Given I have provided a valid PAT and selected a team
    When The system validates my permissions
    Then I receive confirmation that Linear integration is ready and credentials are stored

  Scenario: Insufficient permissions detected
    Given My PAT lacks project creation permissions for the selected team
    When The system validates my permissions
    Then I receive a specific error about missing permissions and guidance on PAT scope requirements

  Scenario: Setup completion under 90 seconds
    Given I am a new user starting Linear integration setup
    When I complete the entire 'planr linear init' flow
    Then The process completes successfully in under 90 seconds

