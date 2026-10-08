export declare const PROTOCOL_V15_CONTRACTS: Readonly<Record<string, string>>;
export declare const PROTOCOL_V16_CONTRACTS: Readonly<Record<string, string>>;
export declare const PROTOCOL_V17_CONTRACTS: Readonly<Record<string, string>>;
export declare const PROTOCOL_V18_CONTRACTS: Readonly<Record<string, string>>;
export declare const PROTOCOL_V111_CONTRACTS: Readonly<Record<string, string>>;
export declare function protocolAssetUrl(
  kind: string,
  options?: {
    protocolVersion?:
      | '1.5.0'
      | '1.6.0'
      | '1.7.0'
      | '1.8.0'
      | '1.11.0'
      | '1.13.0'
      | '1.15.0'
      | '1.16.0'
      | '1.17.0';
  },
): URL;
export declare const PROTOCOL_V113_CONTRACTS: Readonly<Record<string, string>>;

export declare const PROTOCOL_V115_CONTRACTS: Readonly<Record<string, string>>;
export declare function validateDiagramReviewArtifact(
  kind: string,
  value: unknown,
  options?: { protocolVersion?: string },
): Array<{ path: string; rule: string; detail: string }>;

export declare const PROTOCOL_V116_CONTRACTS: Readonly<Record<string, string>>;

export declare const PROTOCOL_V117_CONTRACTS: Readonly<Record<string, string>>;

export declare const PROTOCOL_V119_CONTRACTS: Readonly<Record<string, string>>;
export declare function validateEnterpriseJourneyArtifact(
  kind: string,
  value: unknown,
): { path: string; rule: string; detail: string }[];
