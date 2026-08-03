/**
 * Credential storage backends.
 *
 * Three backends in order of preference:
 * 1. OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * 2. Encrypted file (~/.planr/credentials.enc) using AES-256-GCM
 * 3. Legacy plaintext file (~/.planr/credentials.json) — read-only, for migration
 */
export type CredentialSource = 'env' | 'keychain' | 'encrypted-file';
export interface CredentialBackend {
    readonly name: CredentialSource;
    get(provider: string): Promise<string | undefined>;
    set(provider: string, value: string): Promise<void>;
    delete(provider: string): Promise<boolean>;
    isAvailable(): Promise<boolean>;
}
export declare class KeychainBackend implements CredentialBackend {
    readonly name: "keychain";
    isAvailable(): Promise<boolean>;
    get(provider: string): Promise<string | undefined>;
    set(provider: string, value: string): Promise<void>;
    delete(provider: string): Promise<boolean>;
}
export declare class EncryptedFileBackend implements CredentialBackend {
    readonly name: "encrypted-file";
    private readonly planrDir;
    private readonly encryptedFile;
    private readonly saltFile;
    constructor(planrDir?: string);
    isAvailable(): Promise<boolean>;
    private loadAll;
    private saveAll;
    get(provider: string): Promise<string | undefined>;
    set(provider: string, value: string): Promise<void>;
    delete(provider: string): Promise<boolean>;
}
export declare class LegacyPlaintextBackend {
    exists(): Promise<boolean>;
    loadAll(): Promise<Record<string, string>>;
    remove(): Promise<void>;
}
export declare const keychainBackend: KeychainBackend;
export declare const encryptedFileBackend: EncryptedFileBackend;
export declare const legacyBackend: LegacyPlaintextBackend;
//# sourceMappingURL=credential-backends.d.ts.map