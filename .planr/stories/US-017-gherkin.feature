@v1
Feature: Organization branding in reports (US-017)
  Branding and extra sections come from `.planr/config.json` (`reports`) and optional template overrides.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Branding fields flow into report templates
    Given `reports.orgName`, `reports.accentColor`, or `reports.customSections` are set in config
    When I run `planr report weekly --no-github --stdout`
    Then the rendered output reflects those branding fields where templates reference them

  @v1
  Scenario: Invalid Handlebars in a template fails with a clear error
    When template rendering throws due to syntax or data issues
    Then `planr report` exits with a non-zero status and surfaces the render error message
