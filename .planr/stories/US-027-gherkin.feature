@v1
Feature: Email distribution (US-027)
  SMTP-based email is not implemented in v1; configuration errors are explicit.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Email delivery reports not implemented
    When code paths call email distribution without a fully configured SMTP integration
    Then the user receives a message that SMTP delivery is not available in this build

  @v2
  Scenario: HTML email with PDF attachment (deferred)
    Given SMTP settings and PDF generation exist
    When sending an executive report
    Then recipients receive HTML email with PDF attachment
