@v1
Feature: Standup transcript input (US-028)
  v1 accepts transcript text via file or stdin (any external STT or dictation tool).

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Standup from transcript file
    Given a text file contains a rough standup transcript
    When I run `planr voice standup --file transcript.txt`
    Then structured Yesterday/Today/Blockers markdown is printed

  @v2
  Scenario: Live microphone capture with real-time transcription (deferred)
    Given the CLI can access microphone hardware
    When I start live dictation
    Then audio streams to a speech-to-text provider with live preview
