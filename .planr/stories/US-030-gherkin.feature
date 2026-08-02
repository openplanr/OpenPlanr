@v1
Feature: Edit and refresh standup drafts (US-030)
  Developers refine text in an editor or reload an updated transcript file.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Interactive edit via editor
    Given an interactive terminal with `$EDITOR` configured
    When I run `planr voice standup --file transcript.txt --edit`
    Then I can modify the generated markdown before it is printed or saved

  @v1
  Scenario: Reload transcript from disk
    Given I previously generated output from `--file`
    When I choose to re-read the transcript in an interactive session (`--reload-file`)
    Then the CLI regenerates standup markdown from the latest file contents

  @v2
  Scenario: Replay audio for a text span (deferred)
    Given audio capture stores offsets per segment
    When I select a section during review
    Then the matching audio clip plays
