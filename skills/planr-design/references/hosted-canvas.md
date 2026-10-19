# Design on the host's design canvas

Some hosts can publish a hosted design canvas: live artboards with pan, zoom,
in-place edits and Play for interactive boards. When the host exposes an artifact
tool that offers a design quickstart or a Design artifact type, build the design
there. Hosts without one use the local studio unchanged.

## Choose the path

- Use the hosted canvas when that tool is callable and the user has not asked
  for the local studio. Say so in one line and name the escape, for example:
  "Designing on your host's design canvas. Say 'use the local studio instead'
  for an encrypted company review."
- Use the local studio when the user asks for it, asks for an encrypted company
  review or share link, or the canvas cannot be created or published. Name the
  reason when it is a failure, keep any work already written and continue locally.
- Before creating the canvas, say in one line that the design is published to
  the host's service and stays private to the user until they share it.

## Ground and direct

Discovery, questions, direction, design-system reuse and craft are unchanged:
follow [discovery.md](discovery.md), [design-system.md](design-system.md) and
[craft.md](craft.md). The project's own tokens, fonts and components govern the
boards. Use a design system hosted by the canvas service only when the project
has none and the user picks one when asked; otherwise build the look yourself.

## Build the canvas

1. Call the tool's quickstart with intent `design`, then create one canvas from
   the Design type it names, titled with the design's name.
2. Follow the instructions the create result returns for file shapes, sizes and
   publish calls. They are versioned with the Design type and win over this
   page on format.
3. Use `<design directory>/hosted-canvas/` as the canvas root, with the design
   directory from [handoff.md](handoff.md). The canvas index and every board file
   then stay in the project as editable source.
4. Author one board per screen in the screen inventory, plus a board per extra
   responsive frame the design needs, with the entry board first. Make the
   primary journey work: mark its boards interactive with functional controls.
   Keep rationale out of the boards, as for the studio.
5. Publish the index and the first board together, then one board per call.

The local-sources rule in [generation.md](generation.md) does not apply here:
fonts, images and links follow the Design type's rules. The canvas renders on
the host's service, and the Design type may ask not to re-render or inspect it
unless the user asks, so report the design as not browser-verified unless the
user asked for and received a check.

## Hand off

Write `design-spec.md` at the path in [handoff.md](handoff.md) with all ten
sections of the [template](design-spec-template.md). Below the selected-direction
line add `> Canvas: <canvas URL>` and `> Board source: <path to the board files>`.
Name each screen's board file in the screen inventory. This path writes no
`design-document.json`, studio, `review-context.json` or `finalized.json`; the
specification and board sources are Plan's inputs.

Return the direction, the canvas link, the specification and board-source paths,
and the verification status. Review happens in the canvas's own comments; apply
revisions with the Design type's revising steps and keep the specification in
step. OpenPlanr Studio cannot open a hosted canvas yet, so do not offer it.
