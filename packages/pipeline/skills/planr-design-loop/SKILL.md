---
name: planr-design-loop
description: Explore multiple design directions and collect pinned board feedback. Use when the user wants to compare variants and select a direction interactively.
license: MIT
---

# Planr Design Loop

1. Run `planr pipeline design-loop <target>` with the user's provider, count,
   and project options. If paid generation needs a genuinely missing choice,
   use the host's native question UI to ask for it once.
2. Treat the board as the chooser and its feedback file as the only pin/rating
   authority. Chat is a progress channel, not a substitute for board feedback.
3. Keep variant failures visible, use the engine's declared fallback, and
   preserve different typography, palette, and layout directions.
4. Sharing and feedback import are separate actions. Never upload merely
   because a board was opened or a direction was selected.
5. Record the selected direction and rejected alternatives from board feedback,
   then report the available next actions. Do not auto-chain unrelated PLAN,
   SHIP, landing, publication, or deployment work.
