export const OPERATE_PROTOCOL_VERSION = '1.2.0';
export const OPERATE_SCHEMA_VERSION = '1.0.0';
/**
 * Protocol v1.3 is delivered ADDITIVELY. The v1.2 on-disk artifact envelope —
 * stamped through `OPERATE_PROTOCOL_VERSION` and every `ProtocolArtifact` — is
 * frozen at `1.2.0` so pack-mode artifacts (operating-evidence,
 * operating-workspace-manifest, operating-outcome, …) keep validating against
 * the schemas the pipeline publishes only at 1.2.0. Mutating that shared symbol
 * would restamp those frozen artifacts to `1.3.0`, where no schema exists, and
 * fail closed inside `assertOperatingArtifact` for every pack-mode caller. The
 * v1.3 surface is instead the new mission-packet family, whose dedicated
 * schemas the pipeline publishes exclusively at 1.3.0; it carries its own
 * protocol version through this constant.
 */
export const OPERATE_MISSION_PROTOCOL_VERSION = '1.3.0';
export const OPERATE_AGENT_PROTOCOL_VERSION = '1.4.0';
export class OperateError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = code;
        this.code = code;
        this.details = details;
    }
}
//# sourceMappingURL=types.js.map