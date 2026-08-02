@v1
Feature: Generate reports using Handlebars templates (US-014)
  Developers generate stakeholder-ready reports from `.planr/` data using Handlebars templates shipped with the CLI.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Generate a weekly report from templates and artifacts
    Given templates exist at `src/templates/reports/` and artifacts exist under `.planr/`
    When I run `planr report weekly --no-github --stdout`
    Then the output contains rendered sections from the weekly template and planning data

  @v1
  Scenario: Broken or missing template surfaces a clear error
    When I run `planr report` with a type whose template cannot be rendered
    Then the CLI exits with a non-zero status and an error mentioning template rendering

  @v1
  Scenario: Report still renders when optional data is missing
    Given no sprint id is passed and GitHub may be disabled
    When I run `planr report weekly --no-github --stdout`
    Then the output includes guidance or placeholders where sprint or GitHub data is absent
