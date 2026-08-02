Feature: File Size Validation with Error Messages
  US-003 - As a As a CLI user, I want to I want clear error messages when my input files exceed size limits so that So that I understand the limitation and know how to fix the issue

  Background:
    Given the system is initialized

  Scenario: Accept files under size limit
    Given A user provides a file under 500KB
    When The system validates the file size
    Then The file is accepted for processing

  Scenario: Reject oversized files with clear message
    Given A user provides a file over 500KB
    When The system validates the file size
    Then The file is rejected with a clear error message explaining the limit and suggesting solutions

  Scenario: Handle empty or missing files
    Given A user references a file that doesn't exist or is empty
    When The system validates the file
    Then An appropriate error message is shown indicating the file issue

