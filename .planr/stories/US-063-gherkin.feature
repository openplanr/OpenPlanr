Feature: Map Linear workflow states to OpenPlanr status values
  US-063 - As a As a product manager, I want to I want Linear workflow states automatically mapped to OpenPlanr status values so that So that status changes flow seamlessly between systems without manual translation

  Background:
    Given the system is initialized

  Scenario: Standard workflow state mapping
    Given A Linear issue changes from 'In Progress' to 'Done'
    When Status sync processes the change
    Then The OpenPlanr artifact status updates from 'active' to 'completed'

  Scenario: Custom workflow state mapping
    Given A Linear team uses custom workflow states like 'Code Review'
    When Status sync encounters the custom state
    Then The system maps it to the configured OpenPlanr status based on user mapping rules

  Scenario: Unknown workflow state handling
    Given A Linear issue has a workflow state not in the mapping configuration
    When Status sync processes the change
    Then The system logs a warning and skips the update without failing

