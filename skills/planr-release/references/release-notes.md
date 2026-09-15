# Writing user-facing release notes

Contents:
1. Who is reading
2. Voice rules
3. Worked rewrites
4. Handling breaking changes
5. Section ordering and grouping
6. Channel formats
7. What to leave out

---

## 1. Who is reading

Someone who uses the product, has a limited budget of attention for it, and is scanning for one of three things: did the thing that annoyed me get fixed, can I now do something I could not before, and do I have to change anything.

Everything below follows from that. The reader does not care which service was refactored, and will never read a sentence that opens with "we".

---

## 2. Voice rules

**Lead with the user's new capability, not the implementation.** The subject of the sentence should be the thing they can do or the thing that now works, not the code that was written.

**Use the product's own vocabulary.** If the UI says "Availability", the notes say Availability, not `schedule_slots` and not "the calendar module". A reader who cannot map an entry to something they can see on screen will skip it.

**Describe fixes by symptom.** The reader recognizes the symptom, because they experienced it. They have no way to recognize the cause.

**One line per entry.** If an entry genuinely needs more, write one line and link to a doc. Multi-paragraph entries mean the section is being used as a blog post.

**Second person, present tense.** "You can now export" over "users are now able to export".

**No em dashes.** Use a colon, a comma, or two sentences.

**No filler openers.** Cut "we're excited to announce", "as always", "in this release we've been hard at work". The reader is scanning, and every filler word costs them.

**No hedging on fixes.** "Fixed an issue where some users may have occasionally experienced" is four qualifiers protecting the writer at the reader's expense. It broke, it is fixed, say so.

---

## 3. Worked rewrites

**Feature**
- Before: `feat(booking): implement recurring slot generation with rrule parsing`
- After: `Set a session to repeat weekly or monthly instead of creating each one by hand.`

**Feature, buried in implementation**
- Before: `Migrated the availability resolver to a new interval-tree lookup, improving query performance.`
- After: `Availability now loads instantly, even on calendars with hundreds of sessions.`

**Fix, described by cause**
- Before: `Fixed a race condition in the webhook handler's idempotency check.`
- After: `Payments confirmed twice in quick succession no longer create duplicate bookings.`

**Fix, over-hedged**
- Before: `Resolved an issue where some users may have intermittently seen incorrect timezone offsets in certain edge cases.`
- After: `Session times now show in your local timezone after travelling between regions.`

**Improvement, too vague to be worth printing**
- Before: `Various performance improvements and bug fixes.`
- After: either name what got faster and what got fixed, or cut the line entirely. This sentence has never informed anyone.

**Breaking change, softened into invisibility**
- Before: `Updated the booking API response format for consistency.`
- After: `The booking API now returns `startsAt` instead of `start_time`. Update your integration before 15 October, when the old field is removed.`

**Internal work that should not appear at all**
- Before: `Upgraded Prisma to 6.2, refactored the seed script, added integration tests for the payout flow.`
- After: nothing. None of this is observable. Track it in commits.

---

## 4. Handling breaking changes

A breaking change entry needs four things in one or two lines: what changed, what breaks, what to do, and by when.

```
### Removed
- The `/v1/sessions/list` endpoint is gone. Use `/v1/sessions` with the `status`
  filter, which returns the same records. See the migration guide: <link>
```

Rules:

- Put it first, before Added. The reader who stops after three lines must have seen it.
- Never bundle it into a list of unrelated improvements. It gets its own section and, where possible, its own release.
- A changelog entry is not sufficient notice on its own. Anything with an integration cost also needs an in-product notice or a direct message to affected users, because most people do not read changelogs.
- State the date, not "soon".

---

## 5. Section ordering and grouping

Use Keep a Changelog headings so the format is recognizable and tooling can parse it: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

Order by cost of missing it:

1. `Removed` and breaking items in `Changed`
2. `Security`
3. `Added`
4. `Changed`
5. `Deprecated`
6. `Fixed`

Omit any section with nothing in it. Never write "N/A" or "No changes".

If a release has more than about ten entries in one section, group by product area with bold sublabels. Past that length the flat list stops being scannable, which defeats the purpose.

---

## 6. Channel formats

The same release, adapted per channel. Do not paste the changelog everywhere.

- **CHANGELOG.md**: the full record. Every user-visible change, versioned and dated, never edited retroactively except to correct an error.
- **In-product "what's new"**: the top three entries, plain language, linked to the feature. Skip patch releases entirely; interrupting users for a bug fix trains them to dismiss the panel.
- **Email or announcement**: only for features worth an interruption, and for breaking changes. One feature per email beats a digest nobody finishes.
- **Git tag annotation or GitHub release**: the changelog section verbatim, plus the compare link.

---

## 7. What to leave out

Refactors, test coverage, CI changes, dependency bumps without behavior change, formatting, internal renames, infrastructure moves that users cannot detect, and anything gated behind a flag that is still off.

That last one matters at high cadence: code merged behind a disabled flag has not shipped. It belongs in the release where the flag turns on, described from the user's side. Announcing it early produces notes that reference features nobody can find.
