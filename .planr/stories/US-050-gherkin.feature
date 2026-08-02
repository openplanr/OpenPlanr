Feature: Run cache for unchanged artifacts
  US-050 - As a As a developer, I want to I want caching to avoid re-processing unchanged artifacts so that So that revision runs are 80% faster when most artifacts haven't changed

  Background:
    Given the system is initialized

  Scenario: Cache hit skips processing
    Given An artifact was previously processed and cached
    When I run planr revise on the same unchanged artifact
    Then The artifact should be skipped with a cache hit message

  Scenario: Cache miss processes changed artifact
    Given An artifact has been modified since last cache
    When I run planr revise on the modified artifact
    Then The artifact should be processed and cache updated

  Scenario: Dependency change invalidates cache
    Given An artifact is cached but its dependency has changed
    When I run planr revise on the artifact
    Then The artifact should be processed despite being cached

