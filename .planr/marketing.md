Good corrections. Let me retighten with both facts in mind.

## Reframed: you're not catching up, you're building momentum

The 2-weeks-ago post changes the story. You're not announcing after silence — you're **continuing the drumbeat from your intro post**. That's a much stronger position. The narrative is "two weeks ago I introduced planr; here's how it's grown into a full ecosystem since."

That subtle reframe matters. *"Look how much I've shipped already"* lands as confident momentum, not as making up for lost time.

---

## Compressed timeline — 14 days, not 6 weeks

| Phase | Original | Compressed | What ships |
|---|---|---|---|
| **1. Drumbeat resumes** | Week 1 | **Days 1-2** | Demo video + LinkedIn momentum post + X thread |
| **2. Build signal** | Weeks 2-4 | **Days 3-10** | Three deep pieces, one every ~2-3 days |
| **3. Centerpiece** | Week 5-6 | **Day 12-14** | Show HN / Product Hunt + coordinated blast |
| **4. Sustain** | Forever | Forever | Monthly cadence, no change |

**Why not faster than 14 days?** It's not about production time — AI takes the writing from days to hours. It's about *audience attention*. Three posts in 24 hours hit the same eyeballs three times. Spacing pieces 2-3 days apart lets each one breathe and compound. So 14 days is the floor, not the ceiling.

### Day-by-day plan

| Day | Action | Effort |
|---|---|---|
| **1** | Record 3-min demo video (one take, ship rough) | 2 hrs |
| **2** | Publish LinkedIn momentum post + X thread (both link the demo) | 1 hr |
| **3-4** | Stand up `/docs` skeleton (8 pages) | 1 day |
| **5** | Publish technical post: "Why planr CLI and the pipeline share their schema verbatim" | 2 hrs |
| **6-7** | Update `openplanr.dev` hero + add ecosystem section + link `/blueprint` | 1 day |
| **8** | Publish 8-agent factory deep-dive (X thread + cross-post) | 2 hrs |
| **10** | Publish positioning post: "Where OpenPlanr fits next to Cursor / Claude Projects / Copilot" | 2 hrs |
| **12** | **Centerpiece launch day** — see below | full day |
| **13-14** | Respond, follow up, sustain conversations | half-day each |

**Total focused time: ~5 working days spread over 2 weeks.** Doable.

---

## On HN karma 1 — you probably can't reliably Show HN yet

Honest read: technically you *can* submit at karma 1, but the algorithm doesn't trust new accounts. New-account submissions get buried fast unless they catch genuine fire in the first 30 minutes. With karma 1 your post is fragile — one flag from a bored user can kill it before it surfaces.

**Two paths.**

### Path A — Build HN karma over the same 14 days (my recommendation)

In parallel with the launch campaign, spend 15-20 minutes a day on HN commenting:
- Find 3-5 threads daily about AI dev tooling, indie products, programming languages, or dev productivity
- Leave **substantive** comments — share specific experience, ask sharp questions, push back thoughtfully
- Don't promote OpenPlanr in your comments. Be a credible voice first.
- 2 weeks of this gets you to ~50-100 karma comfortably

Then on Day 12, your Show HN lands on a trusted account. **This is the move.** It costs you 15 min/day and dramatically raises the launch ceiling.

### Path B — Skip HN, lean into channels that don't gatekeep

If 14 days of HN engagement isn't appealing, the centerpiece can land elsewhere just as well:

| Channel | Karma needed | Audience match | Notes |
|---|---|---|---|
| **Product Hunt** | None (just an account) | Indie hackers, makers, early adopters | Schedule a launch day — they'll feature you on the homepage. Strong fit for OpenPlanr. |
| **r/ClaudeAI** | None | Exact target audience | Highly engaged, smaller but qualified |
| **r/programming** | Low | Broad dev | Hit-or-miss; needs strong hook in first 200 chars |
| **Indie Hackers** | None | Solo builders, bootstrappers | Friendly, slower-moving, good for narrative posts |
| **Lobste.rs** | Invite-only | Senior devs | Skip unless invited |
| **Dev.to** | None | Devs reading long-form | Cross-post technical pieces; SEO traffic compounds |
| **TLDR newsletter** | Submit form | 1M+ devs | Email submission, no karma needed |

**Recommended Path-B stack for Day 12:** Product Hunt as the centerpiece (replaces Show HN) + r/ClaudeAI + Indie Hackers + Dev.to cross-post + the LinkedIn/X coordinated blast you'd do anyway. Probably outperforms a karma-1 Show HN in terms of qualified traffic.

### What I'd actually do — Path A + Path B both

You don't have to choose. Spend 15 min/day building HN karma, **and** plan Day 12 around Product Hunt + Reddit + Dev.to as your safe channels. If your HN karma hits 50+ by Day 12, Show HN that morning *in addition*. If not, skip it and let Product Hunt carry the centerpiece.

---

## Updated centerpiece (Day 12) plan

Replace "Show HN day" with **"Product Hunt launch day, with HN as a stretch goal"**:

- **Pre-day:** Schedule Product Hunt launch via their scheduler (they recommend Tuesday 12:01am Pacific)
- **Day-of, 8am Pacific:** X/Twitter post linking PH page; LinkedIn announcement
- **9am:** Reddit posts (r/ClaudeAI, r/programming, r/cursor)
- **10am:** Indie Hackers post
- **11am:** Dev.to cross-post of the strongest technical piece
- **Afternoon:** If HN karma is 50+, submit Show HN. Otherwise hold off.
- **All day:** Be online, respond fast, engage every comment

That's the centerpiece. Two weeks from today.

---

## TL;DR adjustments

1. **Reframe**: "continuing the drumbeat" not "catching up after silence"
2. **14 days**, not 6 weeks
3. **Product Hunt > Show HN** while you're karma 1
4. **Build HN karma in parallel** — 15 min/day commenting, no promotion
5. Everything else (the demo video, the docs site, the openplanr.dev evolution, the personal brand angle) stays exactly as I described

Want the demo script, the Day-2 LinkedIn momentum post, or a Product Hunt launch checklist drafted next?
---
# Demo Production + Week-by-Week Guidance

## On camera/voice — skip both for the first video

Honest recommendation: **screen-only recording with text overlays. No face, no voice, no AI narration.**

Reasoning specific to your audience and content:

| Approach | Verdict for first video |
|---|---|
| Screen + text overlays (silent, music optional) | ✅ **Recommended.** Senior devs watching a CLI demo want to see the workflow, not your face. Text overlays land cleaner than narration for technical demos. |
| Screen + your real voice | Good for video #2. Builds trust, but adds production complexity (mic setup, scripting, retakes). |
| Screen + ElevenLabs voice | ❌ Skip. AI voice on a tech demo reads as lazy to the dev audience. They'll spot it in 5 seconds. |
| Face on camera | ❌ Skip for now. High anxiety + steep learning curve + not what your audience needs. Save for v3 once you're comfortable. |

**Why text overlays win for this specific demo:**
- The terminal IS the protagonist — your voice would distract from it
- Text appears precisely when needed (you control the pacing in editing)
- No re-recording for verbal mistakes
- Production time: 2-4 hours total
- Looks polished by default with the right tool

**The tool to use: [Screen Studio](https://www.screen.studio/)** ($89 one-time, Mac only). Auto-zooms on cursor clicks, smooth animations, beautiful by default. If you're on Linux/Windows or want free: **[Tella](https://www.tella.tv/)** (free tier) or **OBS + DaVinci Resolve**.

Save the ElevenLabs experiment for the **getting-started walkthrough** on `/docs` later — narrated tutorials are a different format and ElevenLabs works fine there.

---

## The 3-minute demo script

Target length: **2:45-3:15.** Don't pad. Below 3 minutes outperforms above 3 minutes by a wide margin on every platform.

### Pre-recording setup

- Terminal: solid dark background, JetBrains Mono 16pt, prompt simplified to `$` only
- Editor: VS Code, dark theme, font 14pt
- Browser tab ready: `~/Work/openplanr-space/designs/openplanr-ecosystem-blueprint.html` open at the composition diagram
- Project ready: clean directory at `~/demos/auth-app/` with a real `package.json` so the demo isn't fictional
- Clear shell history: `clear; history -c`

### The script (with on-screen text + timing)

```
─────────────────────────────────────────────────────────────────
[0:00 – 0:08]  HOOK
─────────────────────────────────────────────────────────────────
SCREEN:        openplanr.dev landing page hero
TEXT OVERLAY:  "Plan once. Ship with agents."
                Fade in below: "An ecosystem for spec-driven AI dev"
DURATION:      8 seconds — short and punchy

─────────────────────────────────────────────────────────────────
[0:08 – 0:18]  THE PROBLEM
─────────────────────────────────────────────────────────────────
SCREEN:        Cut to the composition diagram (zoomed)
TEXT OVERLAY:  "Most AI coding tools skip the plan."
                Then: "OpenPlanr makes the plan the contract."
DURATION:      10 seconds

─────────────────────────────────────────────────────────────────
[0:18 – 0:50]  ACT I — AUTHOR THE PLAN (planr CLI)
─────────────────────────────────────────────────────────────────
SCREEN:        Terminal in ~/demos/auth-app/

TYPE:          $ planr spec create "User authentication" --slug auth --priority P0
OUTPUT:        ✓ SPEC-001-auth created
TEXT OVERLAY:  "1. Author the spec"

TYPE:          $ planr spec shape SPEC-001
SHOW:          Brief 4-question prompt sequence (skip through fast in editing)
TEXT OVERLAY:  "Four questions, no vim required"

TYPE:          $ planr spec decompose SPEC-001
OUTPUT:        ✓ Scanning codebase…
               ✓ 3 stories · 5 tasks
               ✓ Written to .planr/specs/SPEC-001-auth/
TEXT OVERLAY:  "AI decomposes into stories + tasks"

CUT TO:        File tree of .planr/specs/SPEC-001-auth/
               (showing design/, stories/, tasks/ folders populated)
TEXT OVERLAY:  "Shared schema. No glue scripts."

DURATION:      32 seconds

─────────────────────────────────────────────────────────────────
[0:50 – 1:30]  ACT II — REVIEW (the human gate)
─────────────────────────────────────────────────────────────────
SCREEN:        VS Code, opening tasks/T-002-jwt-middleware.md
SHOW:          The frontmatter (storyId, files to create/modify/preserve)
               then scroll the task body briefly
TEXT OVERLAY:  "2. Human reviews. Edits anything."
                Then: "The pipeline refuses to ship without this gate."

DURATION:      20 seconds — keep it brief, don't read the file

─────────────────────────────────────────────────────────────────
[1:30 – 2:30]  ACT III — SHIP (the pipeline)
─────────────────────────────────────────────────────────────────
SCREEN:        Claude Code window

TYPE:          /openplanr-pipeline:ship auth
SHOW:          Streaming subagent output (speed up 2-4x in editing):
               • frontend-agent: 2 tasks
               • backend-agent: 3 tasks (parallel)
               • qa-agent: build + tests pass
               • devops-agent + doc-gen: parallel
               ✓ CLAUDE.md refreshed

TEXT OVERLAY (sequenced as each agent runs):
               "8 subagents · tool-layer enforced"
               "Parallel by topological group"
               "QA gate before docs + Docker"
               "3-iteration correction loop, then error report"

DURATION:      60 seconds — this is the centerpiece, give it room

─────────────────────────────────────────────────────────────────
[2:30 – 2:55]  THE PAYOFF
─────────────────────────────────────────────────────────────────
SCREEN:        File tree showing src/, tests/, docker-compose.yml, Docs/feat-auth/
TEXT OVERLAY:  "From one spec to a shipping feature"
                Then: "Code · Tests · Docker · Docs"

CUT TO:        Quick git diff or `git status` showing the staged changes
TEXT OVERLAY:  "Ready for PR"

DURATION:      25 seconds

─────────────────────────────────────────────────────────────────
[2:55 – 3:05]  CTA
─────────────────────────────────────────────────────────────────
SCREEN:        openplanr.dev hero again
TEXT OVERLAY:  "openplanr.dev"
                Then: "$ npm i -g openplanr"
                Then: "MIT · open source · github.com/openplanr"

DURATION:      10 seconds — fade out
─────────────────────────────────────────────────────────────────
```

**Total runtime: 3:05.** Within the sweet spot.

### Editing notes

- **Speed up the AI streaming output 3-4x** during the pipeline ship phase — nobody wants to watch real-time agent output. Keep the visual texture, kill the dead time.
- **Music**: pick something low-energy electronic from Epidemic Sound or Artlist — don't use silence (feels amateur), don't use anything with vocals. Lo-fi or ambient electronic only.
- **Text overlay style**: stick to one font (DM Sans matches your brand), one color (mint `#5eead4`), one position (bottom-third or top-right). Consistency reads as polish.
- **First and last frame matter most**. Spend disproportionate effort on the opening 2 seconds and the closing CTA — those get screenshotted and shared.
- **Caption export**: when you upload, generate captions automatically (most platforms now have this). Many viewers watch muted.

### Where to publish

| Platform | Format | Notes |
|---|---|---|
| **YouTube** (unlisted at first) | Native upload | Make this the canonical URL; everyone else embeds it |
| **X/Twitter** | Native upload (under 2:20) | Cut to a 2:00 version specifically for X — last 60 sec moves the needle most |
| **LinkedIn** | Native upload (full 3:00) | Keeps watching better than X |
| **openplanr.dev hero** | YouTube embed | Replaces nothing; adds a video element above or below the install command |
| **GitHub READMEs** | Animated GIF clip + YouTube link | Take the 30-second pipeline-ship segment as a GIF |

---

## Now the steps — Day 1 to Day 14

You saved the plan to `.planr/marketing.md` — nice meta touch, you're using planr to plan planr's launch. Lean into that. Track each task there, and on Day 12 mention it in the launch post. *"I planned this campaign in the same tool I'm shipping."* Real product proof.

### Setup (do today, 30 min)

```
$ cd ~/Work/your-launch-project
$ planr quick create "Day 1: Record OpenPlanr demo v1"
$ planr quick create "Day 2: Publish LinkedIn momentum post"
$ planr quick create "Day 2: Publish X thread"
$ planr quick create "Day 3-4: Stand up /docs skeleton"
$ planr quick create "Day 5: Technical post — schema sharing"
$ planr quick create "Day 6-7: openplanr.dev hero update"
$ planr quick create "Day 8: 8-agent factory deep-dive"
$ planr quick create "Day 10: Positioning post"
$ planr quick create "Day 12: Product Hunt launch + cross-channel blast"
$ planr quick create "Days 1-12: HN karma building (15 min/day)"
```

That gives you a checklist. Tick them off as you go.

### Day 1 — Today

**Morning (3 hours):**
1. Install Screen Studio (or your tool of choice)
2. Set up the demo project at `~/demos/auth-app/` — real package.json, real stack file, clean state
3. Practice run the demo end-to-end **without recording** — twice. Get the muscle memory down.
4. Record three takes back-to-back. Don't try to be perfect, just don't fumble the commands.

**Afternoon (2 hours):**
5. Edit the best take. Add text overlays per the script. Speed up dead zones.
6. Export at 1080p. Upload to YouTube as **unlisted**.
7. Watch it once on your phone. If the first 8 seconds aren't compelling, re-edit the opener.

**Evening:**
8. Sleep on it. Don't publish anything tonight.

### Day 2 — Publish

**Morning:**
1. Re-watch the demo with fresh eyes. If it still works, lock it. Set YouTube to **public**.
2. Write the LinkedIn post (use the demo as the centerpiece). Structure:
   - Hook line (1-2 sentences)
   - "Two weeks ago I shipped planr v1.0. Here's where it's at now:" + 4-5 bullet points
   - The video embed
   - "Open source, MIT, link in comments" + GitHub URL in comments to avoid LinkedIn link-suppression
3. Write the X thread (8-10 tweets):
   - Tweet 1: hook + video
   - Tweets 2-7: one bullet per major capability (spec mode, 8-agent factory, shared schema, tool-layer rules, etc.)
   - Tweet 8: link to GitHub + landing page
   - Pin it to your profile

**Afternoon:** publish. **Twitter at 9-10am Eastern, LinkedIn at 11am Eastern.** Don't publish both at the same time.

**Whole day:** respond to every comment within 30 min. First-day engagement determines reach.

### Day 3-4 — Docs skeleton

Use Nextra. Init in your existing Next.js site (or stand up a new subdomain `docs.openplanr.dev`).

8 pages, in this order of priority:
1. `/docs` — overview, install, what each component is
2. `/docs/getting-started` — first 5 minutes (with the demo embedded)
3. `/docs/planr-cli` — top-level CLI reference (link out to subsections)
4. `/docs/spec-driven-mode` — the bridge guide (most important page)
5. `/docs/pipeline` — plugin overview
6. `/docs/pipeline/subagents` — the 8 agents, what each does, tool restrictions
7. `/docs/recipes/from-spec-to-shipped-feature` — end-to-end walkthrough
8. `/docs/faq` — start with 5 questions, grow over time

Don't perfect them. Ship. You'll iterate based on actual user questions.

### Day 5 — First deep-dive post

**Topic: "Why I refused to write a conversion adapter between my CLI and my plugin"**

This is your sharpest technical insight. The fact that planr CLI and the pipeline share `.planr/specs/` schema verbatim — no glue scripts, no transformer — is genuinely interesting design. Most projects in this space DO have conversion layers.

Structure:
- Lead: the problem (two products, both need to read/write specs)
- The wrong solution: building an adapter (why teams default to it)
- The decision: design them to share the schema verbatim
- The mechanic: how it works (frontmatter conventions, directory layout)
- The payoff: zero schema drift, zero adapter to maintain
- The lesson: contracts > adapters

500-800 words. Publish on **Dev.to** + **Hashnode** + your personal blog if you have one. Cross-post link to X and LinkedIn.

### Day 6-7 — openplanr.dev hero update

The current hero stays. Below the fold, add:
1. The composition diagram (lift it from the blueprint HTML — same SVG)
2. A 3-card row: planr / pipeline / skills (lift from the blueprint, simplify)
3. "Read the full blueprint →" link to `/blueprint` (host the new HTML at that path)
4. Embed the demo video above or below the install CTA — depending on what looks better

Don't redesign anything. Add a section. 1 day max.

### Day 8 — 8-agent factory deep-dive

Twitter/X thread (12 tweets):
- Tweet 1: hook + screenshot of the pipeline diagram
- Tweets 2-9: one tweet per agent, what it does, what tools it can/can't use
- Tweet 10: the 3-iteration correction loop
- Tweet 11: the human gate (why it's mandatory)
- Tweet 12: link to docs + repo

Cross-post to LinkedIn as a single long-form post (LinkedIn rewards depth, threads don't work there).

### Day 10 — Positioning post

The honest "where does this fit" piece. Format: Dev.to long-form (1200-1800 words).

Title: *"OpenPlanr vs Cursor agents vs Claude Projects: when to use what"*

Lay out three categories:
- **Real-time pair programming** (Cursor, Copilot) — best for: editing as you think
- **Conversation-driven implementation** (Claude Projects) — best for: ad hoc tasks within a known codebase
- **Spec-driven factories** (OpenPlanr) — best for: planned features with explicit handoff

Don't trash any of them. Be the one piece that fairly maps the space. People will share that as the canonical comparison reference for months.

### Day 12 — Centerpiece launch

**Product Hunt** as primary, HN as stretch goal if karma allows.

Pre-day prep (Day 11):
- Schedule Product Hunt for 12:01am PST
- Line up 5-10 supporters who'll comment + upvote in the first hour
- Prepare the launch images (PH wants 1270x760)
- Draft all the cross-channel posts

Day-of:
- 12:01am: PH goes live (auto)
- 7am: you wake up, check, respond to early commenters
- 8am: X/Twitter announcement linking PH
- 9am: LinkedIn announcement
- 10am: Reddit (r/ClaudeAI, r/programming)
- 11am: Indie Hackers
- 12pm: Dev.to cross-post your strongest piece
- All afternoon: respond to every single comment everywhere within 15 min
- Evening: post a thank-you/results tweet

### Days 13-14 — Sustain

Don't go dark. Reply to lingering comments. Post one follow-up thread on what worked, what didn't, what's next. **The follow-up post often outperforms the launch post** because it shows authenticity.

Then: monthly cadence forever.

---

## HN karma building — parallel track, 15 min/day

While the campaign runs, spend 15 min/day on HN:
- Open `news.ycombinator.com` once a day
- Find 3 threads where you have actual experience to add
- Leave one substantive comment per thread (3+ sentences, specific, ideally with a counterpoint or anecdote)
- Avoid: drive-by snark, "great post," anything self-promotional, comments that just agree

Realistic karma trajectory: ~5-15/day if your comments are good. By Day 12 you'll have 50-150 karma. Enough that a Show HN won't be auto-killed.

---

## What to send me back

If you want, send me:
- The Day 1 demo recording (rough cut is fine) — I'll review pacing + text overlay rhythm
- The Day 2 LinkedIn draft — I'll tighten it before you publish
- The Day 5 schema-sharing post outline — I'll sharpen the hook

Or if you'd rather work asynchronously and just ship: go. The plan is solid. Trust the timeline. **The single most important thing this week is shipping the demo on Day 1.** Everything compounds from there.
