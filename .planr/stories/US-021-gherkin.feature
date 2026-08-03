@v1
Feature: Report quality linter (US-021)
  `planr report-linter` and `planr report --lint` apply configurable rules for vague language and structure.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Clean report avoids error-severity linter failures
    Given a markdown report uses concrete language and required weekly headings
    When I run `planr report-linter --type weekly` on that file
    Then the command exits successfully

  @v1
  Scenario: Vague language triggers linter findings
    Given a report contains phrases matched by default vague-language rules
    When I run `planr report-linter --type weekly` on that file
    Then the output lists findings with suggested alternatives

  @v1
  Scenario: Weekly structure rule checks for Wins, Risks, and Ask headings
    Given a weekly report missing one of those headings
    When I run `planr report-linter --type weekly`
    Then the linter emits warnings describing the missing section
