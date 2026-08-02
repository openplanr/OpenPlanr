@v1
Feature: Slack distribution (US-025)
  Reports post to Slack Incoming Webhooks configured in `.planr/config.json`.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Dry run succeeds even when webhook URL is not set
    When I run `planr report weekly --push slack --dry-run`
    Then the command explains that no POST occurred and how to configure `distribution.slackWebhookUrl`

  @v1
  Scenario: Real post requires a valid webhook URL
    Given `distribution.slackWebhookUrl` points to a valid Slack incoming webhook
    When I run `planr report weekly --push slack` without `--dry-run`
    Then Slack receives a JSON payload with the report text

  @v1
  Scenario: Slack webhook HTTP failures show status and body
    Given the webhook URL returns a non-2xx response
    When I run `planr report weekly --push slack`
    Then the CLI exits with an error that includes HTTP status and response text

  @v2
  Scenario: Route different report types to different channels (deferred)
    Given executive vs weekly channel mapping in config
    When generating each report type
    Then only the configured channel receives that report type
