---
name: planr-design
description: Design a polished product interface through adaptive consultation, a shared canvas/prototype/walkthrough studio, and an implementation-ready specification. Use for a new design or an existing interface that needs a coherent direction.
license: MIT
---

# Planr Design

Develop one strong direction in the active host session, grounded in the product
and its visual language. Deliver editable local source, a working review studio,
and a ten-section design specification ready for Plan.

## Consult and establish direction

Read [discovery.md](references/discovery.md) before generating. Inspect the brief,
app shell, components, tokens, assets, reference screens, prior design and project
taste. Ask only consequential unresolved questions using the host's native
structured question surface, or one concise chat question when unavailable.
Honor previous answers and presentation choices. Evolve existing designs by
default; replacement retains a recoverable prior revision.

Use [design-system.md](references/design-system.md) to reuse the app's system or
establish a deliberate greenfield system. Existing project conventions take
precedence over generic spacing, typography and frame defaults.

## Author and inspect

Read [generation.md](references/generation.md) and [craft.md](references/craft.md).
Use the [document contract](schemas/design-document.schema.json) to create one
design document with stable screens and authored local sources. Canvas,
Prototype and Walkthrough are views of that document; view changes never start
generation. Use a native designer agent when available, otherwise perform the
work directly. Semantic design work stays in this active host session.

Read [team-review.md](references/team-review.md) and author `review-context.json`
beside the design document before rendering every new design. Write its welcome
purpose and up to three consequential review questions from this project's brief
and settled answers. Preserve existing guidance; never invent requirements or
reuse another project's welcome copy.

Use [utilities.md](references/utilities.md) for the bundled deterministic helper
at [scripts/design.mjs](scripts/design.mjs). It inspects, validates, renders, opens,
exports and records feedback without a separate CLI installation. When available,
use the public `planr artifact` route to open the design document.

Inspect browser screenshots and exercise the primary journey and keyboard behavior
at declared frames. Correct observed failures, then record evidence. Static lint
alone cannot establish visual verification. When browser inspection is unavailable,
return the artifact as **unverified**.

The studio can create an encrypted collaborative review for a company team. When
the user asks to share, refresh and render the welcome context, inspect it in the
studio, then open Share. Explain the stable review link, separately entered access
token and private owner controls; never create or send a link without that
explicit request.

## Review and hand off

Read [review.md](references/review.md) when feedback arrives. Pins and ratings come
from the board; chat may request broader changes. Preserve unrelated screens,
stable anchors and board arrangement during scoped revisions.

Finish with [handoff.md](references/handoff.md) and its
[ten-section template](references/design-spec-template.md). The design author
writes `design-spec.md` in this run, including image-based inputs. Return the
studio/source/specification paths, chosen direction, verification result and any
remaining questions. Stop here: Plan, Ship, creating a share link and deployment
are separate user actions. Use Design Loop when the user requests alternatives, and Design
Review for focused iteration on an existing direction.

For company reviews and implementation handoff, follow
[team-review.md](references/team-review.md). Keep review guidance outside product
screens, preserve reviewer intent, and let the owner approve the refined handoff.
