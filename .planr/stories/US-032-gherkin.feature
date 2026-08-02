Feature: Define AI revision decision schema with evidence taxonomy
  US-032 - As a As a developer, I want to I want a typed schema for AI revision decisions so that So that revision decisions are structured and verifiable

  Background:
    Given the system is initialized

  Scenario: Valid revision decision with code evidence
    Given An AI decision with type 'revise' and code_reference evidence
    When The decision is validated against aiReviseDecisionSchema
    Then The decision passes validation with typed evidence

  Scenario: Invalid decision missing required evidence
    Given An AI decision with type 'revise' but no evidence citations
    When The decision is validated against aiReviseDecisionSchema
    Then Validation fails with clear error about missing evidence

  Scenario: Flag decision with ambiguity evidence
    Given An AI decision with type 'flag' and ambiguity evidence
    When The decision is validated against aiReviseDecisionSchema
    Then The decision passes validation as a flagged item

