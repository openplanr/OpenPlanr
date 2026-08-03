Feature: Create buildRevisePrompt function for artifact context packaging
  US-034 - As a As a developer, I want to I want to package artifacts with context for AI revision so that So that AI has complete information to make revision decisions

  Background:
    Given the system is initialized

  Scenario: Build prompt with artifact and context
    Given An artifact and codebase context
    When I call buildRevisePrompt with the artifact
    Then It returns a structured prompt with artifact content and context

  Scenario: Include parent chain in prompt
    Given An artifact with parent relationships
    When I call buildRevisePrompt with the artifact
    Then The prompt includes parent artifact content for context

  Scenario: Handle artifact with no context
    Given An artifact with minimal context available
    When I call buildRevisePrompt with the artifact
    Then It returns a valid prompt with available information only

