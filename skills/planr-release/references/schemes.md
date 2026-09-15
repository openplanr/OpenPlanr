# Choosing and running a versioning scheme

Contents:
1. The question the version number answers
2. SemVer
3. CalVer
4. Two version lines
5. Monorepos
6. Pre-1.0 and pre-release tags
7. Worked selections

---

## 1. The question the version number answers

A version number is a compression of "what am I dealing with". Different audiences ask different questions, and the scheme should answer the one that actually gets asked.

- A developer who installed your package asks **"can I upgrade without breaking?"** That is a compatibility question, and SemVer answers it.
- A user of a hosted app asks **"is this current, and what changed?"** That is a recency question, and CalVer answers it.
- Support asks **"which build is this person on?"** Either works, as long as it is visible in the product.

Pick the scheme that answers the question your actual audience asks. Applying SemVer to a SaaS dashboard where nobody can pin a version produces a number that looks meaningful and is not.

---

## 2. SemVer

`MAJOR.MINOR.PATCH`, incremented on compatibility impact against a declared public API.

Use when consumers pin, install or integrate: npm and PyPI packages, SDKs, CLIs, public HTTP APIs, anything with a dependency range pointed at it.

**The prerequisite is a declared public surface.** Without it the scheme is unusable, because "breaking" is defined relative to something. Write the surface down in the profile. For a TypeScript package that means exported types and functions from the entrypoint, not everything importable via deep paths. For an HTTP API it means documented endpoints, request and response shapes, status codes, auth flow and webhook payloads.

Anything outside the declared surface can change in a patch. This is what makes SemVer survivable: without a boundary, every internal rename is theoretically breaking and you never ship a minor again.

**Bump rules:**

- MAJOR: remove or rename anything in the surface, change a response or return shape, change a default that alters outcomes, tighten validation to reject formerly valid input, add a required parameter, change error semantics that callers branch on.
- MINOR: add to the surface, add an optional parameter, add a new endpoint or export, ship a deprecation warning.
- PATCH: fix behavior to match documentation, performance, internal changes, dependency updates with no surface impact.

**The judgement call that comes up most:** a bug fix that changes behavior people depend on. Strictly it is a fix, but if the buggy behavior is load-bearing for existing users, treat it as breaking. The test is whether shipping it silently would generate support tickets.

---

## 3. CalVer

`YYYY.MM.PATCH` (recommended default), `YYYY.MM.DD`, or `YY.MINOR.PATCH`.

Use for hosted apps, internal tools, and anything where the user is always on the latest version because you put them there.

**What it does well:** answers "how stale is this" instantly, no argument about whether something is a minor or a major, and it maps naturally onto a release rhythm.

**What it cannot do:** carry a compatibility signal. `2026.09.1` to `2026.10.0` tells the reader nothing about whether anything broke. That obligation moves entirely onto the release notes, so a CalVer product must lead its notes with breaking changes and must announce them in-product, not just in a changelog nobody reads.

Recommended format is `YYYY.MM.PATCH`: `2026.09.0` for the first September release, `2026.09.1` for the next. The month gives recency, the counter distinguishes multiple releases within it, and it sorts correctly as a string. Avoid `YYYY.M.D` with unpadded numbers, since it sorts wrong and reads ambiguously.

---

## 4. Two version lines

The most common structural mistake is a single number covering both an app and the API it exposes. They change for unrelated reasons and have different audiences, so one number cannot serve both. A UI redesign is a big deal to users and a non-event to integrators. An API field rename is the reverse.

When a product has both, run:

- **App version:** CalVer, shown in the UI footer or settings, referenced in support and release notes.
- **API version:** SemVer, or a dated URL version (`/v1/`, `2026-09-08`), governed by its own compatibility policy and deprecation timeline.

Record both in the profile, with a note on which one the release notes are written against. Usually the app version leads and API changes appear as a clearly marked section.

---

## 5. Monorepos

Two viable models. Pick one and record it.

**Fixed (single version across all packages).** Every package ships the same number. Simple to reason about, simple to support, at the cost of publishing no-change versions for untouched packages. Good when the packages are only ever consumed together.

**Independent (per-package versions).** Each package versions on its own changes. Correct for consumers, more machinery. Use Changesets in a JS/TS monorepo: contributors add a changeset describing the change and its bump level as part of the PR, and the tool aggregates them into version bumps and changelog entries at release time.

Independent versioning plus Changesets is the better default when packages have separate consumers, because it captures the bump decision at the moment the author still remembers the intent, rather than reconstructing it from commit messages weeks later.

---

## 6. Pre-1.0 and pre-release tags

**0.x** signals "the surface is not stable yet, expect breaks". Under SemVer convention, `0.MINOR.PATCH` treats minor as the breaking position. This is a legitimate state for something genuinely still forming.

It stops being legitimate once real users depend on it. A product with paying customers on `0.x` is either lying about its stability or has forgotten to cut 1.0. Cutting 1.0 is a promise about the public surface, not a claim of feature completeness, and delaying it past the point of real usage costs credibility.

**Pre-release identifiers:** `1.4.0-beta.1`, `2026.09.0-rc.2`. Use for builds going to a subset of users before general release. They sort before the final version, and package managers exclude them from normal ranges. Do not use them as a permanent staging label; something that lives on `-beta` for a year is just the product.

---

## 7. Worked selections

**A booking site for a single business.** One audience, always on latest, no integrators. CalVer `YYYY.MM.PATCH`. The public surface is the booking flow itself, and the only breaking-class events are things like changing how existing appointment links resolve.

**A mentorship platform with a Stripe-backed API and webhooks.** Two lines. CalVer for the app, SemVer for the API and webhook payloads, because integrators parse those payloads and a field rename genuinely breaks them. Webhook payload shape belongs in the declared public surface even though it is easy to forget.

**A published npm package used by other teams.** SemVer, strict, with the declared surface listed as the entrypoint exports. Consumers automate upgrades against the number, so accuracy matters more than convenience.

**An internal admin tool.** CalVer, minimal ceremony. Nobody pins it, and the useful question is "is this the build from before or after the fix".
