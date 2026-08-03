Feature: Atomic Write System with Backup
  US-039 - As a As a developer using planr revise, I want to I want file modifications to be atomic with automatic backup so that So that I can recover from write failures and ensure no partial writes corrupt my artifacts

  Background:
    Given the system is initialized

  Scenario: Successful atomic write
    Given A revision is approved and ready to write
    When The atomic write system processes the change
    Then A backup is created, the file is updated atomically, and the backup is retained

  Scenario: Write failure rollback
    Given A revision write encounters an error during file modification
    When The atomic write system detects the failure
    Then The original file is restored from backup and the error is logged

  Scenario: Backup cleanup on success
    Given Multiple revisions complete successfully
    When The atomic write system finishes all operations
    Then Temporary files are cleaned up while backups are preserved for rollback capability

