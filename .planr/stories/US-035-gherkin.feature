Feature: Build revise service for single-artifact dry-run processing
  US-035 - As a As a developer, I want to I want to process single artifacts for revision decisions so that So that I can test revision logic before implementing full cascade

  Background:
    Given the system is initialized

  Scenario: Process artifact and return revision decision
    Given A valid artifact and codebase context
    When I call reviseArtifact in dry-run mode
    Then It returns a structured revision decision without modifying files

  Scenario: Handle AI service errors gracefully
    Given An artifact but AI service is unavailable
    When I call reviseArtifact in dry-run mode
    Then It returns an error decision with clear failure reason

  Scenario: Validate decision schema compliance
    Given An artifact that generates an AI response
    When I call reviseArtifact in dry-run mode
    Then The returned decision conforms to aiReviseDecisionSchema

