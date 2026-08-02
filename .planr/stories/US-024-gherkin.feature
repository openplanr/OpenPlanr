@v1
Feature: Stakeholder report formats (US-024)
  v1 ships Markdown and HTML. PDF is not bundled; the CLI returns an explicit error.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Markdown report is written by default
    When I run `planr report weekly --no-github`
    Then a `.md` file is created under `.planr/reports/` with dated filename

  @v1
  Scenario: HTML report is available alongside markdown
    When I run `planr report weekly --no-github --format html`
    Then both `.md` and `.html` outputs are written under `.planr/reports/`

  @v1
  Scenario: PDF format is rejected with a clear message
    When I run `planr report weekly --format pdf`
    Then the CLI exits with a non-zero status and mentions that PDF is unavailable in this build
