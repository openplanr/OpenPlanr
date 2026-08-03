Feature: Token budget guards for AI operations
  US-049 - As a As a developer, I want to I want token budget controls for revise operations so that So that I can prevent runaway costs while allowing normal usage

  Background:
    Given the system is initialized

  Scenario: Token budget prevents expensive operations
    Given A token budget of 10000 tokens is configured
    When I run planr revise with operations estimated at 15000 tokens
    Then The command should block and display the estimated vs budget cost

  Scenario: Token budget allows normal operations
    Given A token budget of 10000 tokens is configured
    When I run planr revise with operations estimated at 5000 tokens
    Then The command should proceed and display remaining budget

  Scenario: Token budget warning at threshold
    Given A token budget of 10000 tokens is configured
    When I run planr revise with operations estimated at 8500 tokens
    Then The command should warn about approaching budget limit but proceed

