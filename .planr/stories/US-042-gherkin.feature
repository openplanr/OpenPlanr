Feature: Sibling context gathering for related artifacts
  US-042 - As a As a developer, I want to I want artifacts to have access to their sibling context during revision so that So that revisions can maintain consistency across related artifacts at the same level

  Background:
    Given the system is initialized

  Scenario: Feature siblings context
    Given An epic with 5 features being revised
    When Feature-2 is being processed
    Then It receives context from Feature-1, Feature-3, Feature-4, and Feature-5 as sibling context

  Scenario: Large sibling set memory management
    Given An epic with 50 features each containing substantial content
    When A feature is being revised with sibling context
    Then Only essential sibling metadata is loaded, not full content, to prevent memory overflow

  Scenario: No siblings available
    Given A single feature under an epic with no other features
    When The feature is being revised
    Then It processes normally with empty sibling context and logs the absence

