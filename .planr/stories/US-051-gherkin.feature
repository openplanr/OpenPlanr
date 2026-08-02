Feature: Fast processing mode without code context
  US-051 - As a As a developer, I want to I want a --no-code-context flag for faster processing so that So that I can quickly revise artifacts when code context is not needed

  Background:
    Given the system is initialized

  Scenario: No code context flag skips codebase analysis
    Given I have artifacts that need revision
    When I run planr revise --no-code-context
    Then The revision should process without gathering codebase context

  Scenario: No code context still includes artifact context
    Given I have artifacts with parent and sibling relationships
    When I run planr revise --no-code-context
    Then The revision should include artifact chain and siblings but no code files

