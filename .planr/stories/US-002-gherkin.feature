Feature: Prompt Injection Detection and Blocking
  US-002 - As a As a security-conscious user, I want to I want the system to detect and block potential prompt injection attempts so that So that malicious users cannot manipulate AI behavior through crafted inputs

  Background:
    Given the system is initialized

  Scenario: Block instruction override attempts
    Given A user submits input containing system instruction overrides
    When The input validation runs
    Then The injection attempt is detected and blocked with an error message

  Scenario: Allow legitimate user content
    Given A user submits normal content without injection patterns
    When The input validation runs
    Then The content passes validation and proceeds to prompt construction

  Scenario: Block delimiter escape attempts
    Given A user tries to escape boundary delimiters in their input
    When The input validation runs
    Then The escape attempt is detected and the input is rejected

