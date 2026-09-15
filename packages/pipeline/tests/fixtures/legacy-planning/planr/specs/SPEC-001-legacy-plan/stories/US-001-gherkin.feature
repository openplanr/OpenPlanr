Feature: Active implementation context

  Scenario: Carry the selected task into Ship
    Given a planned task with concrete file and technical requirements
    When Ship builds the coding context
    Then the coding runtime receives those requirements without workflow bookkeeping
