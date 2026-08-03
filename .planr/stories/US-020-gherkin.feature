@v1
Feature: Evidence context in HTML reports (US-020)
  HTML reports convert markdown; evidence items include inline detail text beside links where templates provide it.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: HTML export includes evidence content as readable list items
    When I run `planr report weekly --format html --no-github` and open the generated HTML
    Then list items in the Evidence area include human-readable labels and hyperlinks

  @v2
  Scenario: Rich hover tooltips for each link (deferred)
    Given stakeholders need browser tooltips on evidence links
    When viewing HTML in a browser
    Then each link may expose extra metadata via `title` attributes in a future release
