/**
 * Global non-interactive state.
 *
 * Centralises the check so prompt-service doesn't need
 * a reference to the Commander program instance.
 */
export declare function setNonInteractive(value: boolean): void;
export declare function isNonInteractive(): boolean;
/**
 * Exit early if --manual is used in a non-interactive environment.
 * Call this at the top of any command action that supports --manual.
 */
export declare function requireInteractiveForManual(manual: boolean | undefined): void;
//# sourceMappingURL=interactive-state.d.ts.map