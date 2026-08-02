Feature: Mid-cascade graceful interrupt with audit flush
  US-044 - As a developer running a cascade revision, I want Ctrl+C and [q]uit to stop the cascade gracefully while keeping already-applied artifacts applied, so I can walk away from a long cascade mid-flight without losing completed work or corrupting the repo.

  Background:
    Given the system is initialized
    And a cascade is running with 1 epic, 3 features, and 12 tasks in scope

  Scenario: User quits at a diff prompt mid-cascade
    Given The cascade has successfully applied 1 epic and 2 features
    And The user is presented with the diff preview for the 3rd feature
    When The user selects [q]uit
    Then The cascade stops immediately without prompting for remaining artifacts
    And The 1 epic and 2 features that were already applied remain applied on disk
    And The 3rd feature and all later artifacts remain untouched
    And The audit log has already persisted entries for the 3 applied artifacts and records a final "interrupted by user (q)" entry

  Scenario: SIGINT (Ctrl+C) during cascade
    Given The cascade has successfully applied 1 epic and 1 feature
    And A 2nd feature's artifact is currently being written to disk
    When The user sends SIGINT (Ctrl+C)
    Then The in-flight atomic write completes (temp file + rename) so no artifact is left partially written
    And The cascade stops before starting the next artifact
    And The audit log records a final "interrupted by user (SIGINT)" entry with the exact count of applied artifacts

  Scenario: AI service error mid-cascade
    Given The cascade has successfully applied 1 epic and 2 features
    When The 3rd feature's agent call fails with a provider error
    Then The failing artifact is recorded in the audit log with action "failed" and the provider error message
    And The cascade stops (does not auto-retry or auto-skip in v1)
    And The 1 epic and 2 features that were already applied remain applied on disk
    And The exit code signals failure so CI pipelines can detect the partial run

  Scenario: Successful cascade with no interruption
    Given A cascade that processes all artifacts without errors or interruptions
    When The cascade completes
    Then All artifacts are applied and the audit log captures every decision
    And No rollback is triggered — the post-flight graph integrity check (FEAT-013) passes cleanly

  Scenario: Partial cascade breaks graph integrity
    Given A cascade was interrupted after applying an epic but before its child feature
    And The epic revision modified a parent → child reference that now points at an unrevised child
    When The post-flight graph integrity check runs (FEAT-013)
    Then The graph break is detected and FEAT-013's post-flight rollback restores the affected paths via git checkout
    # This scenario documents the handoff between FEAT-012 (graceful stop, no rollback here) and FEAT-013 (post-flight rollback as the safety net).
