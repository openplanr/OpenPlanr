# Discovery and adaptive consultation

Start from evidence, then ask the smallest set of questions that changes the
design. A clear brief is usable input; do not force a source/format questionnaire.

## Ground the brief

- Read the requested spec or task and its parent story/feature when present.
  Find the project root and `.planr/config.json`. Missing planning records do not
  block an explicit brief. Never choose among multiple matching specs silently.
- Inspect the app entrypoint and shell, routes, representative working screens,
  component library, CSS tokens/theme configuration, fonts, logos and images.
  Inspect available screenshots visually rather than deriving aesthetics from
  filenames. Record what comes from the project versus inference.
- Find prior `design-document.json`, `finalized.json`, `design-spec.md`, board
  feedback and project-local taste. Read source before attempting regeneration.
  Preserve design/screen/variant/anchor identities and the previous working result.
- Summarize the actual user, job to be done, primary journey, screen inventory,
  necessary states and constraints. Include loading, empty, error and success
  behavior where the journey requires them; do not multiply screens speculatively.

## Ask what remains consequential

Use the host's native structured questions when callable. Otherwise ask one concise
chat question at a time. Neither a missing question tool nor a thin screen list is
a technical blocker. Do not ask the user to locate files that exploration can find.

| Missing decision | Useful question | Evidence that settles it |
| --- | --- | --- |
| Audience or main job | Who uses this, and what must they finish first? | Explicit role, journey and success criterion in the brief |
| Conflicting source | Which of the two discovered specs defines this design? | Exact path or identifier provided by the user |
| Scope from a thin brief | Should this cover the full signup journey or only account creation? | Concrete requirements imply an unambiguous bounded journey |
| Visual direction | Should this extend the current brand or explore a new identity? | User explicitly requests continuity or a redesign |
| Responsive use | Is the main context a desktop workspace or a phone in the field? | Product requirements or existing supported breakpoints |
| Initial presentation | Would you prefer the artboard overview or to click through the journey first? | Explicit canvas/prototype/walkthrough request |

Recommend the option grounded in evidence; explain its effect in one sentence.
Ask only unresolved axes and honor previous answers. For reversible presentation
defaults, Canvas suits comparison, Prototype suits a single surface or interaction,
and Walkthrough suits a guided sequence. All three remain available from one source.
If assumptions are authorized, state them and record them in the specification.

## Record the useful outcome

Write a short brief/provenance record next to the editable source: audience, main
journey, screen/state scope, visual direction, declared responsive frames, explicit
answers, references actually inspected and remaining assumptions. Persist project
design tokens and brand guidance using [design-system.md](design-system.md).

Normal Design produces one direction. Design Loop explores three by default.
Existing work evolves by default; replacement keeps a recoverable original. Image
references may guide authored interfaces or remain static reference boards. Name
which capability was delivered; an image with pins is not a functional prototype.
