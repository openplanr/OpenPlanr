export declare const DESIGN_REVIEW_CONTEXT_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_FINGERPRINT_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_REVIEW_BUNDLE_V11_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_HANDOFF_CONTENT_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_HANDOFF_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_REVIEW_METADATA_PAYLOAD_V11_SCHEMA: Readonly<Record<string, unknown>>;
export declare const REVIEW_EXPERIENCE_SCHEMAS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;
export declare function assertReviewExperience<T>(
  value: T,
  contract: Readonly<Record<string, unknown>>,
): T;
export declare function assertDesignReviewBundle<T>(value: T): T;
export declare function assertDesignReviewMetadata<T>(value: T): T;
