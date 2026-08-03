Feature: Linear Team Selection
  US-055 - As a As a product manager, I want to I want to select which Linear team to integrate with so that So that OpenPlanr creates issues in the correct team workspace

  Background:
    Given the system is initialized

  Scenario: Team selection from multiple teams
    Given My Linear PAT has access to multiple teams
    When I complete authentication and see the team selection prompt
    Then I can choose from a list of available teams and my selection is stored

  Scenario: Single team auto-selection
    Given My Linear PAT only has access to one team
    When I complete authentication
    Then The single team is automatically selected and stored without prompting

  Scenario: No team access error
    Given My Linear PAT has no team access or insufficient permissions
    When I complete authentication
    Then I receive a clear error about insufficient permissions and setup fails

