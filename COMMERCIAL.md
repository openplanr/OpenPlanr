# Open source and the hosted service

OpenPlanr is two things with one clear line between them: open-source local
workflows, and governed collaboration for companies.

## What this repository is

Everything in this repository is [MIT licensed](LICENSE), subject to the component
notices retained with their source: the `planr` CLI, the Protocol contracts, the
host-native skills, deterministic validation and rendering, the local dashboard and
review studios, and the public clients that talk to a hosted workspace when you ask
them to. The MIT license permits commercial use, modification, distribution, and
private use. No subscription is needed to exercise those rights.

## What the hosted service is

OpenPlanr company workspaces are a separately operated service for teams that want
shared artifact revisions, review workflows, organization and project access, storage,
search, audit, enterprise identity, billing, and support around the same planning
files. Access and capabilities are enforced by the service and governed by its own
subscription and service terms.

The public client code (`planr company`) and the Protocol contracts describe how local
tools communicate with the service. They contain no credentials, tenant data, or hosted
infrastructure, and they grant no entitlement to an operated deployment. The service
implementation lives in separate repositories. Accepted repository content always stays
in Git and `.planr/`; hosted revisions are shared collaboration state, and browser
proposals never execute code.

**Status.** Company workspaces are deployed and under validation; they are not generally
available. Source availability and passing tests do not establish service levels,
compliance certification, or production support commitments, and published terms must
match the deployed product before customers are admitted.

## Names and reporting

The [trademark policy](TRADEMARKS.md) governs the OpenPlanr name and visual identity.
The [security policy](SECURITY.md) explains how to report vulnerabilities in either the
repository or the service.
