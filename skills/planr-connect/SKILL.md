---
name: planr-connect
description: Report which chat, project tracker and source control connections the host has, and guide connecting the missing ones through the host. Use when the user wants to connect a service for OpenPlanr or asks what is connected.
argument-hint: "[chat|project-tracker|source-control|product]"
license: MIT
---

# OpenPlanr Connect

Report which service categories this host can reach and help the user connect
the missing ones through the host's own connectors. OpenPlanr installs no
connector and never handles a credential: the vendor publishes the connector and
the user signs in through the host.

## Check each category

The categories are ~~chat, ~~project tracker and ~~source control; their
products and per-host steps are in [connectors](references/connectors.md). With an
argument, check only that category; a product name from connectors selects the
category it belongs to.

A category is connected when the host exposes a tool for one of its products,
loaded or deferred; search the host's deferred tool list by product name when it
has one. For ~~project tracker and ~~source control, a signed-in GitHub CLI also
counts: `gh auth status --hostname github.com` succeeds. Judge by the tools you
can see; never call a tool that writes, posts or changes anything to find out.

## Connect a missing category

Work through these steps in order for each missing category:

1. **Already available.** If a matching tool appeared since the last check,
   report the category as connected and name the product. If the host lists the
   product's connector but offers only a sign-in or authentication notice instead
   of its tools, report it as configured but not signed in, tell the user to sign
   in from the host's connector settings, and skip the next two steps for it.
2. **Connector suggestions.** If the host offers a connector-suggestion
   capability, such as a tool that searches its connector directory and another
   that shows a Connect card from a search result, search with the category's
   product names and the category name, show the card for the best match, and
   wait for the user to connect. Do not assume any particular tool name.
3. **Host step.** Otherwise print the current host's step and the vendor's
   documentation link from [connectors](references/connectors.md).

Then ask the user to run `/planr-connect` again once signed in. Do not retry on
your own. If a workspace admin must approve the vendor's app first, say so.

## Rules

- Never ask for, read, store or print a token, key or password. If the user
  pastes one, do not repeat it, and tell them OpenPlanr does not need it.
- Never edit host configuration, run install or sign-in commands, or sign in on
  the user's behalf.
- Recommend the vendor's own connector from the catalog, never a third-party one.

## Return

One line per category: connected (product), configured but not signed in
(product), or missing with the step shown (Connect card or host step). End with what the user does next.
