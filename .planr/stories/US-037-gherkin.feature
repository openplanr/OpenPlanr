Feature: Evidence Verifier for AI Citations
  US-037 - As a As a developer using planr revise, I want to I want the system to verify AI citations against actual codebase content so that So that I can trust that proposed changes are based on real evidence and not hallucinations

  Background:
    Given the system is initialized

  Scenario: Valid evidence verification
    Given AI proposes a change citing an existing file path and code snippet
    When The evidence verifier checks the citation
    Then The change is approved for diff preview

  Scenario: Invalid evidence rejection
    Given AI proposes a change citing a non-existent file or incorrect code snippet
    When The evidence verifier checks the citation
    Then The change is dropped and logged as unverifiable

  Scenario: Planted hallucination detection
    Given AI proposes a change with fabricated evidence
    When The evidence verifier validates the citation
    Then The change is rejected and the hallucination is flagged in audit log

