Feature: Comprehensive CLI help and documentation
  US-053 - As a As a developer, I want to I want detailed CLI help and README documentation so that So that I can understand common workflows and troubleshoot issues

  Background:
    Given the system is initialized

  Scenario: CLI help shows detailed usage examples
    Given I need help with the revise command
    When I run planr revise --help
    Then Detailed usage examples and options should be displayed

  Scenario: README includes common workflows
    Given I am learning to use the revise command
    When I read the README documentation
    Then Common workflows and troubleshooting guidance should be available

