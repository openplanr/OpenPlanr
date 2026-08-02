Feature: Handle concurrent status modification conflicts
  US-065 - As a As a product manager, I want to I want status sync to handle conflicts when both Linear and OpenPlanr status change simultaneously so that So that competing updates don't cause data loss or sync failures

  Background:
    Given the system is initialized

  Scenario: Linear wins conflict resolution
    Given Both Linear and OpenPlanr status changed since last sync with 'Linear wins' strategy
    When Status sync detects the conflict
    Then OpenPlanr status updates to match Linear and logs the conflict resolution

  Scenario: OpenPlanr wins conflict resolution
    Given Both Linear and OpenPlanr status changed since last sync with 'OpenPlanr wins' strategy
    When Status sync detects the conflict
    Then Linear status would need to be updated to match OpenPlanr (future enhancement) and conflict is logged

  Scenario: Manual conflict resolution required
    Given Both Linear and OpenPlanr status changed since last sync with 'manual' strategy
    When Status sync detects the conflict
    Then The system prompts for user decision and applies the chosen resolution

