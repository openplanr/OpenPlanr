@v1
Feature: Six stakeholder report types (US-015)
  The CLI exposes sprint, weekly, executive, standup, retrospective, and release-oriented reports.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario Outline: Each report type renders successfully
    When I run `planr report <type> --no-github --stdout`
    Then the output contains a top-level title appropriate to the report

    Examples:
      | type       |
      | sprint     |
      | weekly     |
      | executive  |
      | standup    |
      | retro      |
      | release    |
