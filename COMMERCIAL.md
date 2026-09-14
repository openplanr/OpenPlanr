# Open source and hosted OpenPlanr

OpenPlanr combines an open local product with a separately operated hosted
collaboration service. This boundary lets teams inspect and control the tools that
run with their repositories while paying for managed company collaboration and
operations.

## Open local product

The code in this repository is available under the [MIT License](LICENSE), subject
to any component notices retained with their source. It includes the portable CLI,
Protocol contracts, host-native skills, deterministic validation and rendering,
local dashboards and studios, and public clients for explicitly selected
synchronization.

The MIT license permits commercial use, modification, distribution, and private
use. A paid OpenPlanr subscription is not required to exercise those license
rights.

## Hosted company service

The separately deployed company workspace may provide managed organization and
project access, shared artifact revisions, review workflows, storage, search,
audit administration, enterprise identity, billing, integrations, operational
assurance, and support. Service access and capabilities are enforced by the
hosted service and governed by its subscription and service terms.

Public client code and Protocol contracts describe how local tools communicate
with the service. They do not include service credentials, tenant data, hosted
infrastructure, or an entitlement to use an operated deployment.

The hosted implementation and its deployment configuration remain in separately
owned repositories. Existing encrypted token shares retain their distinct access
and deployment model.

## Current availability

Company workspaces are under development and isolated staging or source checks do
not establish general availability, service levels, compliance certification, or
production support commitments. Commercial terms, privacy terms, data-processing
terms, and published service capabilities must match the deployed product before
customers are admitted.

The [trademark policy](TRADEMARKS.md) governs use of the OpenPlanr name and visual
identity. The [security policy](SECURITY.md) explains how to report vulnerabilities.
