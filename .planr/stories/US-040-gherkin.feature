Feature: Diff Preview and Interactive Confirmation
  US-040 - As a As a developer using planr revise, I want to I want to see a diff preview and confirm changes before they are written so that So that I can review and approve each change before it modifies my artifacts

  Background:
    Given the system is initialized

  Scenario: Interactive confirmation workflow
    Given A revision passes evidence verification
    When The system shows the diff preview
    Then I am prompted to confirm the change and can approve or reject it

  Scenario: Bypass mode for automation
    Given I run planr revise with --yes flag
    When A revision passes evidence verification
    Then The change is applied automatically without interactive confirmation

  Scenario: Rejection preserves original
    Given A diff preview is shown for a proposed change
    When I reject the change at the confirmation prompt
    Then The original file remains unchanged and the rejection is logged

